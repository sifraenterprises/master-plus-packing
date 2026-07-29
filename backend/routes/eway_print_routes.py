"""Print E-Way Bill module — queues read-only print_eway_bill jobs executed by the
automation worker on the government e-way bill portal (manual login, never stores
credentials, never generates/cancels/updates e-way bills)."""
import os
import re
import uuid
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import FileResponse
from bson import ObjectId
from pydantic import BaseModel
from database import db
from models import utcnow
from auth import get_current_user, require_admin, log_activity
from automation import EwayPrintAutomation, AutomationError, load_selectors, save_selectors
from environment import env_fields, env_list_filter, env_upload_dir

router = APIRouter(prefix="/eway-print", tags=["eway-print"])

ROOT_DIR = Path(__file__).parent.parent
PRINT_DIR = ROOT_DIR / "uploads" / "eway_prints"
PRINT_DIR.mkdir(parents=True, exist_ok=True)
JOB_TYPE = "print_eway_bill"
WAIT_TIMEOUT = 900

run_state = {"running": False, "run_id": None, "total": 0, "processed": 0, "current": None,
             "started_at": None, "phase": None, "awaiting_login": None, "awaiting_review": None}
login_state = {"event": None, "cancelled": False}
review_state = {"event": None, "record_id": None, "cancelled": False}


def now_iso():
    return utcnow().isoformat()


async def get_mode():
    from environment import get_effective_automation_mode
    return await get_effective_automation_mode()


def make_logger(run_id):
    async def log(event, message, dispatch_id=None, level="INFO"):
        await db.automation_logs.insert_one({
            "id": str(uuid.uuid4()), "run_id": run_id, "module": "eway_print",
            "event": event, "message": message, "dispatch_id": dispatch_id,
            "level": level, "timestamp": now_iso(),
        })
    return log


def job_out(d: dict) -> dict:
    return {"id": str(d["_id"]), "dispatch_id": d.get("dispatch_id", ""),
            "dispatch_no": d.get("dispatch_no", ""), "invoice_no": d.get("invoice_no", ""),
            "eway_bill_number": d.get("eway_bill_number", ""), "status": d.get("status", "Pending"),
            "error_message": d.get("error_message", ""), "pdf_name": d.get("pdf_name", ""),
            "has_pdf": bool(d.get("pdf_path")), "screenshots": d.get("screenshots", {}),
            "retry_count": d.get("retry_count", 0), "last_run_at": d.get("last_run_at", ""),
            "created_at": d.get("created_at", ""), "updated_at": d.get("updated_at", "")}


# ---------- Import & listing ----------

@router.post("/import")
async def import_jobs(user: dict = Depends(get_current_user)):
    """Create print_eway_bill jobs for dispatches with a valid 12-digit e-way bill number."""
    existing = {d["dispatch_id"] async for d in db.eway_print_jobs.find({}, {"dispatch_id": 1})}
    created, skipped_invalid = 0, 0
    q = {"eway_bill_number": {"$nin": ["", None]}, **(await env_list_filter())}
    async for md in db.master_dispatch.find(q):
        mid = str(md["_id"])
        if mid in existing:
            continue
        digits = re.sub(r"\D", "", md.get("eway_bill_number") or "")
        if len(digits) != 12:
            skipped_invalid += 1
            continue
        await db.eway_print_jobs.insert_one({
            "job_type": JOB_TYPE, "dispatch_id": mid,
            "dispatch_no": md.get("dispatch_no", ""), "invoice_no": md.get("invoice_number", ""),
            "eway_bill_number": digits, "status": "Pending", "error_message": "",
            "pdf_path": "", "pdf_name": "", "screenshots": {}, "retry_count": 0,
            "created_by": user["username"], "created_at": now_iso(), "updated_at": now_iso(),
            **(await env_fields())})
        created += 1
    if created:
        await log_activity(user["username"], "eway_print_import", f"{created} job(s) queued", "eway_print")
    return {"created": created, "skipped_invalid": skipped_invalid}


@router.get("/records")
async def list_jobs(status: str = None, search: str = None, page: int = 1, page_size: int = 25,
                    user: dict = Depends(get_current_user)):
    query = await env_list_filter()
    if status and status != "All":
        query["status"] = status
    if search:
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"dispatch_no": rx}, {"invoice_no": rx}, {"eway_bill_number": rx}]
    total = await db.eway_print_jobs.count_documents(query)
    docs = await db.eway_print_jobs.find(query).sort("created_at", -1) \
        .skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [job_out(d) for d in docs], "total": total, "page": page, "page_size": page_size}


@router.get("/stats")
async def stats(user: dict = Depends(get_current_user)):
    base = await env_list_filter()
    out = {}
    for st in ("Pending", "Processing", "Completed", "Failed"):
        out[st.lower()] = await db.eway_print_jobs.count_documents({**base, "status": st})
    out["total"] = await db.eway_print_jobs.count_documents(base)
    return out


# ---------- Run queue ----------

async def process_queue(ids: list[str], run_id: str, user: str, stop_before_download: bool):
    mode = await get_mode()
    log = make_logger(run_id)
    bot = EwayPrintAutomation(mode=mode, headless=False, log=log)

    async def wait_login():
        ev = asyncio.Event()
        login_state.update({"event": ev, "cancelled": False})
        run_state["phase"] = "Waiting for manual portal login"
        run_state["awaiting_login"] = {"requested_at": now_iso(), "timeout_seconds": WAIT_TIMEOUT}
        try:
            await asyncio.wait_for(ev.wait(), timeout=WAIT_TIMEOUT)
        except asyncio.TimeoutError:
            raise AutomationError("Timed out waiting for manual portal login (15 minutes) - nothing was printed")
        finally:
            run_state["awaiting_login"] = None
            login_state["event"] = None
        if login_state["cancelled"]:
            raise AutomationError("Manual portal login cancelled by user - nothing was printed")
        run_state["phase"] = "Logged in"

    current = {"oid": None, "job": None}

    async def wait_review():
        ev = asyncio.Event()
        rid = str(current["oid"])
        review_state.update({"event": ev, "record_id": rid, "cancelled": False})
        run_state["phase"] = "Waiting for review before print/download"
        run_state["awaiting_review"] = {"record_id": rid,
                                        "eway_bill_number": current["job"].get("eway_bill_number", ""),
                                        "dispatch_no": current["job"].get("dispatch_no", ""),
                                        "requested_at": now_iso(), "timeout_seconds": WAIT_TIMEOUT}
        await db.eway_print_jobs.update_one({"_id": current["oid"]}, {"$set": {
            "status": "Waiting for Review", "updated_at": now_iso()}})
        try:
            await asyncio.wait_for(ev.wait(), timeout=WAIT_TIMEOUT)
        except asyncio.TimeoutError:
            raise AutomationError("Timed out waiting for review (15 minutes) - PDF was NOT downloaded")
        finally:
            run_state["awaiting_review"] = None
            review_state["event"] = None
        if review_state["cancelled"]:
            raise AutomationError("Review cancelled by user - PDF was NOT downloaded")
        await db.eway_print_jobs.update_one({"_id": current["oid"]}, {"$set": {
            "status": "Processing", "updated_at": now_iso()}})
        run_state["phase"] = "Downloading"

    bot.login_wait_cb = wait_login
    bot.review_wait_cb = wait_review
    try:
        await log("Run Started",
                  f"Print E-Way Bill: {len(ids)} job(s) in {mode.upper()} mode (user: {user}, "
                  f"stop before download: {'yes' if stop_before_download else 'no'}). "
                  "Read-only job - never generates, cancels or updates e-way bills.")
        download_dir = await env_upload_dir(PRINT_DIR)
        await db.eway_print_jobs.update_many(
            {"_id": {"$in": [ObjectId(i) for i in ids]}},
            {"$set": {"status": "Waiting for Portal Login", "error_message": "", "updated_at": now_iso()}})
        await bot.start_session()  # single manual login for the whole queue
        await db.eway_print_jobs.update_many(
            {"_id": {"$in": [ObjectId(i) for i in ids]}, "status": "Waiting for Portal Login"},
            {"$set": {"status": "Pending", "updated_at": now_iso()}})
        for rid in ids:
            oid = ObjectId(rid)
            job = await db.eway_print_jobs.find_one({"_id": oid})
            if not job:
                run_state["processed"] += 1
                continue
            current["oid"], current["job"] = oid, job
            run_state["current"] = job.get("eway_bill_number", "")
            run_state["phase"] = "Printing"
            await db.eway_print_jobs.update_one({"_id": oid}, {"$set": {
                "status": "Processing", "error_message": "", "run_id": run_id,
                "last_run_at": now_iso(), "updated_at": now_iso()}})
            try:
                res = await bot.print_one(job["eway_bill_number"], stop_before_download,
                                          download_dir, job.get("dispatch_no", ""))
                await db.eway_print_jobs.update_one({"_id": oid}, {"$set": {
                    "status": "Completed", "error_message": "",
                    "pdf_path": res["pdf_path"], "pdf_name": res["pdf_name"],
                    "screenshots": res["shots"], "completed_at": now_iso(),
                    "completed_by": user, "updated_at": now_iso()}})
                await log("Job Completed", f"E-Way Bill {job['eway_bill_number']} printed & PDF stored",
                          job.get("dispatch_no", ""), "SUCCESS")
            except (AutomationError, Exception) as e:
                err = str(e)[:400]
                shot = await bot.capture_screenshot(f"ewbprint_fail_{job['eway_bill_number']}")
                await db.eway_print_jobs.update_one({"_id": oid}, {"$set": {
                    "status": "Failed", "error_message": err,
                    "screenshots": {**(job.get("screenshots") or {}), "failure": shot},
                    "updated_at": now_iso()}, "$inc": {"retry_count": 1}})
                await log("Job Failed", f"E-Way Bill {job['eway_bill_number']}: {err}",
                          job.get("dispatch_no", ""), "ERROR")
                if "login" in err.lower() and "cancel" in err.lower():
                    break  # login cancelled — abort the remaining queue
            run_state["processed"] += 1
        await log("Run Finished", f"Print E-Way Bill queue finished: {run_state['processed']}/{run_state['total']} processed")
    except (AutomationError, Exception) as e:
        err = str(e)[:400]
        await log("Run Aborted", f"Print E-Way Bill run aborted: {err}", level="ERROR")
        await db.eway_print_jobs.update_many(
            {"_id": {"$in": [ObjectId(i) for i in ids]},
             "status": {"$in": ["Waiting for Portal Login", "Processing", "Waiting for Review"]}},
            {"$set": {"status": "Failed", "error_message": err, "updated_at": now_iso()}})
    finally:
        await bot.close()
        run_state.update({"running": False, "current": None, "phase": None,
                          "awaiting_login": None, "awaiting_review": None})
        login_state["event"] = None
        review_state["event"] = None


async def _start(background_tasks: BackgroundTasks, ids: list[str], user: str, stop_before_download: bool):
    await get_mode()  # blocks in maintenance / emergency stop before scheduling
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="A Print E-Way Bill run is already in progress")
    valid = [i for i in ids if ObjectId.is_valid(i)
             and await db.eway_print_jobs.find_one({"_id": ObjectId(i)}, {"_id": 1})]
    if not valid:
        raise HTTPException(status_code=400, detail="No valid jobs to process")
    run_id = str(uuid.uuid4())
    run_state.update({"running": True, "run_id": run_id, "total": len(valid), "processed": 0,
                      "current": None, "started_at": now_iso(), "phase": "Starting",
                      "awaiting_login": None, "awaiting_review": None})
    background_tasks.add_task(process_queue, valid, run_id, user, stop_before_download)
    return {"run_id": run_id, "total": len(valid)}


class RunRequest(BaseModel):
    ids: list[str] = []
    stop_before_download: bool = False


@router.post("/run")
async def run_selected(req: RunRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    result = await _start(background_tasks, req.ids, user["username"], req.stop_before_download)
    await log_activity(user["username"], "eway_print_run", f"{result['total']} job(s)", "eway_print")
    return result


@router.post("/run-all-pending")
async def run_all_pending(req: RunRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    ids = [str(d["_id"]) async for d in db.eway_print_jobs.find(
        {"status": "Pending", **(await env_list_filter())}, {"_id": 1})]
    if not ids:
        raise HTTPException(status_code=400, detail="No pending jobs")
    result = await _start(background_tasks, ids, user["username"], req.stop_before_download)
    await log_activity(user["username"], "eway_print_run_all", f"{result['total']} job(s)", "eway_print")
    return result


@router.post("/retry-failed")
async def retry_failed(req: RunRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    ids = [str(d["_id"]) async for d in db.eway_print_jobs.find(
        {"status": "Failed", **(await env_list_filter())}, {"_id": 1})]
    if not ids:
        raise HTTPException(status_code=400, detail="No failed jobs")
    result = await _start(background_tasks, ids, user["username"], req.stop_before_download)
    await log_activity(user["username"], "eway_print_retry", f"{result['total']} job(s)", "eway_print")
    return result


@router.get("/run-status")
async def run_status(user: dict = Depends(get_current_user)):
    return run_state


# ---------- Wait confirmations ----------

@router.post("/login-wait/confirm")
async def confirm_login(user: dict = Depends(get_current_user)):
    if not login_state.get("event"):
        raise HTTPException(status_code=409, detail="No run is currently waiting for portal login")
    login_state["cancelled"] = False
    login_state["event"].set()
    await log_activity(user["username"], "eway_print_login_confirmed", "", "eway_print")
    return {"ok": True}


@router.post("/login-wait/cancel")
async def cancel_login(user: dict = Depends(get_current_user)):
    if not login_state.get("event"):
        raise HTTPException(status_code=409, detail="No run is currently waiting for portal login")
    login_state["cancelled"] = True
    login_state["event"].set()
    await log_activity(user["username"], "eway_print_login_cancelled", "", "eway_print")
    return {"ok": True}


@router.post("/review-wait/confirm")
async def confirm_review(body: dict, user: dict = Depends(get_current_user)):
    if not review_state.get("event") or review_state.get("record_id") != body.get("record_id"):
        raise HTTPException(status_code=409, detail="No job is currently waiting for review")
    review_state["cancelled"] = False
    review_state["event"].set()
    await log_activity(user["username"], "eway_print_review_confirmed", "", "eway_print")
    return {"ok": True}


@router.post("/review-wait/cancel")
async def cancel_review(body: dict, user: dict = Depends(get_current_user)):
    if not review_state.get("event") or review_state.get("record_id") != body.get("record_id"):
        raise HTTPException(status_code=409, detail="No job is currently waiting for review")
    review_state["cancelled"] = True
    review_state["event"].set()
    await log_activity(user["username"], "eway_print_review_cancelled", "", "eway_print")
    return {"ok": True}


# ---------- Files, logs & selectors ----------

@router.get("/records/{record_id}/pdf")
async def job_pdf(record_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(record_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    doc = await db.eway_print_jobs.find_one({"_id": ObjectId(record_id)})
    if not doc or not doc.get("pdf_path") or not Path(doc["pdf_path"]).exists():
        raise HTTPException(status_code=404, detail="PDF not available")
    return FileResponse(doc["pdf_path"], media_type="application/pdf", filename=doc.get("pdf_name") or "eway_bill.pdf")


@router.get("/screenshots/{name}")
async def job_screenshot(name: str, user: dict = Depends(get_current_user)):
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid screenshot name")
    path = ROOT_DIR / "screenshots" / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(str(path), media_type="image/png")


@router.get("/logs")
async def job_logs(run_id: str = None, dispatch_no: str = None, limit: int = 150,
                   user: dict = Depends(get_current_user)):
    query = {"module": "eway_print"}
    if run_id:
        query["run_id"] = run_id
    if dispatch_no:
        query["dispatch_id"] = dispatch_no
    docs = await db.automation_logs.find(query, {"_id": 0}).sort("timestamp", -1).to_list(min(limit, 500))
    return docs


@router.get("/selectors")
async def get_print_selectors(user: dict = Depends(get_current_user)):
    return load_selectors().get("eway_print", {})


@router.put("/selectors")
async def put_print_selectors(body: dict, user: dict = Depends(require_admin)):
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Selector config must be a non-empty JSON object")
    data = load_selectors()
    data["eway_print"] = {k: str(v) for k, v in body.items()}
    save_selectors(data)
    await log_activity(user["username"], "eway_print_selectors_updated", "", "eway_print")
    return data["eway_print"]


@router.delete("/records/{record_id}")
async def delete_job(record_id: str, user: dict = Depends(require_admin)):
    if not ObjectId.is_valid(record_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    doc = await db.eway_print_jobs.find_one_and_delete({"_id": ObjectId(record_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    if doc.get("pdf_path"):
        Path(doc["pdf_path"]).unlink(missing_ok=True)
    await log_activity(user["username"], "eway_print_job_deleted", doc.get("eway_bill_number", ""), "eway_print")
    return {"ok": True}
