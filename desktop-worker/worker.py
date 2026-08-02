from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import re
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))
load_dotenv(ROOT / ".env")

from automation import (  # noqa: E402
    ASNAutomation,
    EWayBillAutomation,
    EwayPrintAutomation,
    VendorAckAutomation,
    validate_portal,
)
from dqms_automation import DqmsAutomation  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(ROOT / "worker.log", encoding="utf-8")],
)
log = logging.getLogger("desktop-worker")

API_BASE = os.environ.get("API_BASE_URL", "").rstrip("/")
TOKEN = os.environ.get("DESKTOP_WORKER_TOKEN", "")
WORKER_NAME = os.environ.get("WORKER_NAME", socket.gethostname())
HEADLESS = os.environ.get("HEADLESS", "false").lower() == "true"
TEST_MODE = os.environ.get("TEST_MODE", "true").lower() == "true"
POLL_SECONDS = max(3, int(os.environ.get("POLL_INTERVAL_SECONDS", "3")))
HEARTBEAT_SECONDS = max(10, int(os.environ.get("HEARTBEAT_INTERVAL_SECONDS", "30")))


class ApiClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"X-Worker-Token": TOKEN, "User-Agent": "GrewalDesktopWorker/1.0"})

    def request(self, method: str, path: str, **kwargs: Any) -> dict:
        response = self.session.request(method, f"{API_BASE}{path}", timeout=45, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else {}

    def register(self) -> dict:
        return self.request("POST", "/worker/register", json={
            "worker_name": WORKER_NAME,
            "hostname": socket.gethostname(),
            "version": "1.0.0",
            "capabilities": ["portal_validation", "asn_creation", "dqms_start_batch", "eway_bill_entry", "print_eway_bill", "vendor_eway_acknowledgement"],
        })

    def heartbeat(self, current_job_id: str | None, state: str, message: str = "") -> None:
        self.request("POST", "/worker/heartbeat", json={
            "worker_name": WORKER_NAME, "current_job_id": current_job_id,
            "state": state, "message": message[:500],
        })

    def offline(self, message: str = "Worker stopped") -> None:
        self.request("POST", "/worker/offline", json={
            "worker_name": WORKER_NAME, "message": message[:500],
        })

    def claim(self) -> dict | None:
        return self.request("POST", "/worker/jobs/claim", params={"worker_name": WORKER_NAME}).get("job")

    def start(self, job_id: str) -> None:
        self.request("POST", f"/worker/jobs/{job_id}/start", params={"worker_name": WORKER_NAME})

    def progress(self, job_id: str, percent: int, message: str, event: str = "Progress") -> None:
        self.request("POST", f"/worker/jobs/{job_id}/progress", params={"worker_name": WORKER_NAME},
                     json={"progress": percent, "message": message, "event": event})

    def complete(self, job_id: str, result: dict, message: str = "Completed") -> None:
        self.request("POST", f"/worker/jobs/{job_id}/complete", params={"worker_name": WORKER_NAME},
                     json={"result": result, "message": message})

    def fail(self, job_id: str, error: str, retryable: bool = False, result: dict | None = None) -> None:
        self.request("POST", f"/worker/jobs/{job_id}/fail", params={"worker_name": WORKER_NAME},
                     json={"error": error[:4000], "retryable": retryable, "result": result or {}})

    def download_document(self, job_id: str, destination: Path) -> None:
        with self.session.get(
            f"{API_BASE}/worker/jobs/{job_id}/document",
            params={"worker_name": WORKER_NAME}, timeout=90, stream=True,
        ) as response:
            response.raise_for_status()
            with destination.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        output.write(chunk)


api = ApiClient()
current_job_id: str | None = None
stop_event = threading.Event()


def validate_config() -> None:
    missing = [name for name, value in {
        "API_BASE_URL": API_BASE, "DESKTOP_WORKER_TOKEN": TOKEN,
        "TAFE_PORTAL_URL": os.environ.get("TAFE_PORTAL_URL", ""),
        "TAFE_USERNAME": os.environ.get("TAFE_USERNAME", ""),
        "TAFE_PASSWORD": os.environ.get("TAFE_PASSWORD", ""),
    }.items() if not value]
    if missing:
        raise RuntimeError("Missing required settings: " + ", ".join(missing))
    if not API_BASE.startswith("https://"):
        raise RuntimeError("API_BASE_URL must use HTTPS")


def heartbeat_loop() -> None:
    while not stop_event.wait(HEARTBEAT_SECONDS):
        try:
            api.heartbeat(current_job_id, "running" if current_job_id else "idle")
        except Exception as exc:
            log.warning("Heartbeat failed: %s", type(exc).__name__)


async def execute_job(job: dict) -> dict:
    job_type = job["job_type"]
    payload = dict(job.get("payload") or {})
    test_mode = bool(job.get("test_mode", TEST_MODE))
    mode = "test" if test_mode else "live"
    jid = job["id"]

    async def remote_log(event: str, message: str, dispatch_id=None, level="INFO") -> None:
        log.info("[%s] %s", event, message)
        try:
            api.progress(jid, int(payload.get("progress", 25)), message, event)
        except Exception:
            pass

    if job_type == "portal_validation":
        results = await validate_portal(
            attempt_login=bool(payload.get("attempt_login", True)),
            headless=HEADLESS,
            log=remote_log,
            dry_run_fill=bool(payload.get("dry_run_fill", False)),
        )
        passed = all(item.get("status") == "ok" for item in results)
        if not passed:
            raise RuntimeError("Portal validation failed: " + "; ".join(
                item["message"] for item in results if item.get("status") != "ok"))
        return {"checks": results}

    if job_type == "dqms_start_batch":
        return await DqmsAutomation(remote_log).run(payload, test_mode=test_mode)

    if job_type == "eway_bill_entry":
        bot = EWayBillAutomation(mode=mode, headless=HEADLESS, log=remote_log)
        records = payload.get("records") or [payload]
        stop_before_submit = bool(payload.get("stop_before_submit", False))
        results = []
        try:
            await bot.start()
            await bot.login()
            await bot.navigate_to_entry()
            for index, record in enumerate(records, start=1):
                record = dict(record)
                record["dry_run"] = stop_before_submit
                await remote_log(
                    "E-Way Bill Entry",
                    f"Filling {index}/{len(records)}: {record.get('eway_bill_number', '')}",
                )
                await bot.fill_form(record)
                before = await bot.capture_screenshot(
                    f"eway_before_{index}_{jid[-6:]}"
                )
                item = {
                    "eway_bill_number": record.get("eway_bill_number", ""),
                    "before_submit": before,
                    "submitted": False,
                }
                if stop_before_submit:
                    await remote_log(
                        "Dry Run Ready",
                        "Form filled and verified; Submit was not clicked. "
                        "Review or submit manually, then press Enter for the next record.",
                    )
                    await asyncio.to_thread(
                        input,
                        f"Review E-Way Bill {record.get('eway_bill_number', '')}. "
                        "Submit manually if desired, then press Enter to continue: ",
                    )
                    item["reviewed"] = True
                elif not test_mode:
                    await bot.submit()
                    await bot.verify_success()
                    item["submitted"] = True
                results.append(item)
                if index < len(records):
                    await bot.navigate_to_entry()
            return {
                "submitted": all(item["submitted"] for item in results),
                "stop_before_submit": stop_before_submit,
                "count": len(results),
                "items": results,
            }
        finally:
            await bot.close()

    if job_type == "vendor_eway_acknowledgement":
        bot = VendorAckAutomation(mode=mode, headless=HEADLESS, log=remote_log)
        try:
            await bot.start(); await bot.login(); await bot.navigate_to_entry()
            result = await bot.acknowledge(payload)
            result["submitted"] = not test_mode
            return result
        finally:
            await bot.close()

    if job_type == "print_eway_bill":
        bot = EwayPrintAutomation(mode=mode, headless=False, log=remote_log)
        download_dir = Path(
            os.environ.get("EWAY_DOWNLOAD_DIR", str(ROOT / "downloads"))
        ).expanduser().resolve()
        download_dir.mkdir(parents=True, exist_ok=True)
        numbers = payload.get("eway_bill_numbers") or [payload.get("eway_bill_number")]
        numbers = [str(number or "").strip() for number in numbers if str(number or "").strip()]
        if not numbers:
            raise RuntimeError("No E-Way Bill numbers were supplied")
        try:
            await bot.start_session()
            files = []
            for index, number in enumerate(numbers, start=1):
                await remote_log(
                    "Print E-Way Bill",
                    f"Printing {index}/{len(numbers)}: {number}",
                )
                files.append(await bot.print_one(number, download_dir))
                if index < len(numbers):
                    await bot.return_home()
            return {
                "submitted": True,
                "count": len(files),
                "files": files,
            }
        finally:
            await bot.close()

    if job_type == "asn_creation":
        bot = ASNAutomation(mode=mode, headless=HEADLESS, log=remote_log)
        stop_before_submit = bool(payload.get("stop_before_submit", False))
        payload["dry_run"] = stop_before_submit
        allocations = payload.pop("batch_allocations", {})
        payload["manual_batch_selection"] = bool(
            payload.get("manual_batch_selection", stop_before_submit and not allocations)
        )
        pdi_folder = Path(os.getenv("PDI_FOLDER", str(ROOT / "pdi"))).expanduser().resolve()
        invoice_text = str(payload.get("invoice_no") or "")
        invoice_token = re.sub(r"[^A-Za-z0-9]", "", invoice_text).lower()
        invoice_suffix = re.sub(r"[^A-Za-z0-9]", "", invoice_text.rsplit("/", 1)[-1]).lower()
        local_matches = []
        if pdi_folder.is_dir() and invoice_token:
            local_matches = [
                path for path in pdi_folder.glob("*.pdf")
                if (
                    invoice_token in re.sub(r"[^A-Za-z0-9]", "", path.stem).lower()
                    or re.sub(r"[^A-Za-z0-9]", "", path.stem).lower() == invoice_suffix
                )
            ]
        if len(local_matches) > 1:
            raise RuntimeError(
                f"Multiple local PDI PDFs match invoice {payload.get('invoice_no')}; "
                f"keep exactly one matching file in {pdi_folder}"
            )
        if local_matches:
            payload["pdi_path"] = str(local_matches[0])
            await remote_log("PDI Located", f"Using local PDI: {local_matches[0].name}")
        else:
            raise RuntimeError(
                f"Local PDI not found for invoice {payload.get('invoice_no')}. "
                f"Place one matching PDF in {pdi_folder}"
            )

        async def allocation_cb(part, qty, batches):
            configured = allocations.get(part)
            if not configured:
                if len(batches) == 1:
                    batch = batches[0]
                    available = float(batch.get("available_qty") or 0)
                    if available >= float(qty):
                        return [{
                            "batch_no": batch["batch_no"],
                            "allocate_qty": float(qty),
                            "consider": True,
                        }]
                raise RuntimeError(
                    f"Batch allocation required for {part}; "
                    f"portal batches={batches}; provide batch_allocations in the queued job"
                )
            return configured

        bot.allocation_cb = allocation_cb
        try:
            await bot.start(); await bot.login(); await bot.navigate_to_entry()
            result = await bot.run_asn(payload)
            result["submitted"] = not (test_mode or stop_before_submit)
            if result.get("dry_run"):
                hold = int(os.getenv("DRY_RUN_HOLD_SECONDS", "300"))
                log.info("Dry run ready; keeping TAFE form open for %s seconds for review", hold)
                await asyncio.sleep(max(0, hold))
            return result
        finally:
            await bot.close()

    raise RuntimeError(f"Unsupported job type: {job_type}")


def main() -> int:
    global current_job_id
    validate_config()
    api.register()
    api.heartbeat(None, "idle", "Worker started")
    threading.Thread(target=heartbeat_loop, name="heartbeat", daemon=True).start()
    log.info("Worker %s online. Test mode=%s, headless=%s", WORKER_NAME, TEST_MODE, HEADLESS)
    log.info("Waiting for jobs...")

    try:
        while True:
            try:
                job = api.claim()
                if not job:
                    time.sleep(POLL_SECONDS)
                    continue
                current_job_id = job["id"]
                api.start(current_job_id)
                api.progress(current_job_id, 5, f"Started {job['job_type']}", "Job Started")
                try:
                    result = asyncio.run(execute_job(job))
                    api.complete(current_job_id, result, "Desktop automation completed")
                    log.info("Job %s completed", current_job_id)
                except Exception as exc:
                    log.exception("Job %s failed", current_job_id)
                    api.fail(current_job_id, f"{type(exc).__name__}: {exc}", retryable=True)
                finally:
                    current_job_id = None
                    api.heartbeat(None, "idle")
            except requests.RequestException as exc:
                log.warning("VPS connection failed: %s", exc)
                time.sleep(max(POLL_SECONDS, 15))
    except KeyboardInterrupt:
        log.info("Worker stopped by user")
        return 0
    finally:
        stop_event.set()
        try:
            api.offline()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
