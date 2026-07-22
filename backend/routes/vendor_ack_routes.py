import uuid
import time
import logging
from typing import Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import FileResponse
from bson import ObjectId
from pydantic import BaseModel
from pathlib import Path
from database import db
from environment import env_fields, env_list_filter
from models import utcnow
from auth import get_current_user, require_admin, log_activity
from alerts import send_alert
from automation import (
    VendorAckAutomation, AutomationError, DropdownMatchError,
    AsnNotFoundError, AlreadyAcknowledgedError,
)
from routes.worker_routes import (
    create_automation_job,
    desktop_execution_enabled,
    require_desktop_worker,
)

router = APIRouter(prefix="/vendor-ack", tags=["vendor-ack"])

@router.delete("/records/{record_id}")
async def delete_record(record_id: str, user: dict = Depends(require_admin)):
    if not ObjectId.is_valid(record_id):
        raise HTTPException(status_code=400, detail="Invalid acknowledgement record id")
    result = await db.vendor_eway_acknowledgement.delete_one({"_id": ObjectId(record_id), "status": {"$nin": ["Processing"]}})
    if not result.deleted_count:
        raise HTTPException(status_code=409, detail="Processing or missing acknowledgement records cannot be deleted")
    return {"deleted": True}
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent.parent
MAX_RETRIES = 3
IST = timezone(timedelta(hours=5, minutes=30))

run_state = {"running": False, "run_id": None, "ack_id": None, "dispatch_no": None, "started_at": None}


class AckRunRequest(BaseModel):
    dispatch_id: str
    company_code: str = "TMTL"
    transporter: str = ""
    plant: str = ""


def now_iso():
    return utcnow().isoformat()


import os


async def get_mode():
    from environment import get_effective_automation_mode
    return await get_effective_automation_mode()


def serialize_ack(a: dict) -> dict:
    a = dict(a)
    a["id"] = str(a.pop("_id"))
    return a


async def latest_ack(dispatch_id: str):
    return await db.vendor_eway_acknowledgement.find_one({"dispatch_id": dispatch_id})


def join_row(md: dict, ack: Optional[dict]) -> dict:
    return {
        "dispatch_id": str(md["_id"]),
        "dispatch_no": md.get("dispatch_no", ""),
        "invoice_number": md.get("invoice_number", ""),
        "asn_number": md.get("asn_number", "") or "",
        "transporter": md.get("transporter_name", "") or "",
        "plant": md.get("plant", "") or "",
        "company_code": (md.get("customer_code") and "TMTL") or "TMTL",
        "ack": serialize_ack(ack) if ack else None,
        "ack_status": (ack or {}).get("status", "Pending"),
        "ack_date": (ack or {}).get("ack_date"),
        "portal_message": (ack or {}).get("portal_message"),
        "retry_count": (ack or {}).get("retry_count", 0),
    }


async def append_log(ack_oid, run_id: str, event: str, message: str, level: str = "INFO"):
    entry = {"ts": now_iso(), "event": event, "message": message, "level": level}
    await db.vendor_eway_acknowledgement.update_one(
        {"_id": ack_oid}, {"$push": {"execution_log": entry}, "$set": {"updated_at": now_iso()}}
    )
    await db.automation_logs.insert_one({
        "id": str(uuid.uuid4()), "run_id": run_id, "module": "vendor_ack",
        "event": event, "message": message, "level": level, "timestamp": now_iso(),
    })


async def process_ack(ack_id: str, run_id: str, user: str):
    ack_oid = ObjectId(ack_id)
    ack = await db.vendor_eway_acknowledgement.find_one({"_id": ack_oid})
    if not ack:
        run_state["running"] = False
        return
    mode = await get_mode()
    headless = os.environ.get("AUTOMATION_HEADLESS", "true").lower() == "true"

    async def log(event, message, dispatch_id=None, level="INFO"):
        await append_log(ack_oid, run_id, event, message, level)

    bot = VendorAckAutomation(mode=mode, headless=headless, log=log)
    data = {
        "company_code": ack["company_code"], "transporter": ack["transporter"],
        "plant": ack["plant"], "asn_number": ack["asn_number"],
    }
    started = time.monotonic()
    status, portal_message, screenshots = "Failed", "", dict(ack.get("screenshots") or {})
    retryable_attempts = 0
    try:
        await log("Run Started", f"Vendor E-Way Ack for {ack['dispatch_no']} (ASN {ack['asn_number']}) in {mode.upper()} mode by {user}")
        if mode == "live":
            bot.require_env()
        await bot.start()
        await bot.login()
        await bot.navigate_to_entry()
        while True:
            try:
                result = await bot.acknowledge(data)
                now_ist = datetime.now(IST)
                status = "Completed"
                portal_message = result["message"]
                if result.get("before_submit"):
                    screenshots["before_submit"] = result["before_submit"]
                shot = await bot.capture_screenshot(f"vack_success_{ack['dispatch_no']}")
                if shot:
                    screenshots["after_success"] = shot
                await db.vendor_eway_acknowledgement.update_one({"_id": ack_oid}, {"$set": {
                    "ack_date": now_ist.strftime("%Y-%m-%d"), "ack_time": now_ist.strftime("%H:%M:%S"),
                }})
                await log("Success", f"Portal confirmed: {portal_message}", level="SUCCESS")
                break
            except AlreadyAcknowledgedError as e:
                now_ist = datetime.now(IST)
                status = "Completed"
                portal_message = f"Already Acknowledged - {e}"
                await db.vendor_eway_acknowledgement.update_one({"_id": ack_oid}, {"$set": {
                    "ack_date": now_ist.strftime("%Y-%m-%d"), "ack_time": now_ist.strftime("%H:%M:%S"),
                }})
                await log("Already Acknowledged", str(e), level="SUCCESS")
                break
            except AsnNotFoundError as e:
                status = "Pending"
                portal_message = "ASN Details Not Found"
                shot = await bot.capture_screenshot(f"vack_notfound_{ack['dispatch_no']}")
                if shot:
                    screenshots["after_failure"] = shot
                await log("ASN Not Found", f"{e} - record kept Pending, retry allowed", level="WARN")
                break
            except DropdownMatchError as e:
                status = "Failed"
                portal_message = f"Failed - Dropdown Value Not Found: {e}"
                shot = await bot.capture_screenshot(f"vack_dropdown_{ack['dispatch_no']}")
                if shot:
                    screenshots["after_failure"] = shot
                await log("Dropdown Mismatch", str(e), level="ERROR")
                await send_alert("Vendor Acknowledgement failed",
                                 f"Dispatch {ack['dispatch_no']}: {str(e)[:300]}")
                break
            except AutomationError as e:
                retryable_attempts += 1
                if retryable_attempts < MAX_RETRIES:
                    await log("Retry", f"Attempt {retryable_attempts} failed ({e}) - retrying automatically", level="WARN")
                    continue
                status = "Retry Scheduled"
                portal_message = str(e)
                shot = await bot.capture_screenshot(f"vack_fail_{ack['dispatch_no']}")
                if shot:
                    screenshots["after_failure"] = shot
                await log("Error", f"Failed after {retryable_attempts} attempts: {e}", level="ERROR")
                break
    except AutomationError as e:
        status = "Retry Scheduled"
        portal_message = str(e)
        await log("Error", str(e), level="ERROR")
    except Exception as e:
        logger.exception("Vendor ack automation failed")
        status = "Retry Scheduled"
        portal_message = f"Unexpected Error: {type(e).__name__}"
        await log("Error", portal_message, level="ERROR")
    finally:
        await bot.close()
        elapsed_ms = int((time.monotonic() - started) * 1000)
        await db.vendor_eway_acknowledgement.update_one({"_id": ack_oid}, {
            "$set": {"status": status, "portal_message": portal_message, "screenshots": screenshots,
                     "execution_time_ms": elapsed_ms, "updated_at": now_iso()},
            "$inc": {"retry_count": 1 if retryable_attempts >= MAX_RETRIES else 0},
        })
        if ObjectId.is_valid(ack["dispatch_id"]):
            await db.master_dispatch.update_one(
                {"_id": ObjectId(ack["dispatch_id"])},
                {"$set": {"vendor_ack_status": status, "updated_at": now_iso()}},
            )
        await log("Finished", f"Run finished with status '{status}' in {elapsed_ms} ms")
        run_state["running"] = False


# ---------- Endpoints ----------

@router.get("/records")
async def vendor_ack_records(status: Optional[str] = None, search: Optional[str] = None,
                             page: int = 1, page_size: int = 50, user: dict = Depends(get_current_user)):
    query = await env_list_filter()
    if search:
        import re
        rx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"dispatch_no": rx}, {"invoice_number": rx}, {"asn_number": rx},
                        {"transporter_name": rx}, {"plant": rx}]
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    total = await db.master_dispatch.count_documents(query)
    docs = await db.master_dispatch.find(query).sort("created_at", -1).skip((page - 1) * page_size).to_list(page_size)
    ids = [str(d["_id"]) for d in docs]
    acks = {a["dispatch_id"]: a async for a in db.vendor_eway_acknowledgement.find({"dispatch_id": {"$in": ids}})}
    rows = [join_row(d, acks.get(str(d["_id"]))) for d in docs]
    if status and status != "All":
        rows = [r for r in rows if r["ack_status"] == status]
    return {"items": rows, "total": total, "page": page, "pages": max(1, -(-total // page_size))}


@router.get("/stats")
async def vendor_ack_stats(user: dict = Depends(get_current_user)):
    total = await db.master_dispatch.count_documents({})
    counts = {s: await db.vendor_eway_acknowledgement.count_documents({"status": s})
              for s in ("Processing", "Completed", "Retry Scheduled", "Failed")}
    acked_pending = await db.vendor_eway_acknowledgement.count_documents({"status": "Pending"})
    done = sum(counts.values()) + acked_pending
    return {"total": total, "pending": max(0, total - done + acked_pending), **{
        "processing": counts["Processing"], "completed": counts["Completed"],
        "retry_scheduled": counts["Retry Scheduled"], "failed": counts["Failed"],
    }}


@router.post("/run")
async def vendor_ack_run(req: AckRunRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="A Vendor Ack automation run is already in progress")
    if not ObjectId.is_valid(req.dispatch_id):
        raise HTTPException(status_code=400, detail="Invalid dispatch ID")
    md = await db.master_dispatch.find_one({"_id": ObjectId(req.dispatch_id)})
    if not md:
        raise HTTPException(status_code=404, detail="Master Dispatch record not found")
    await get_mode()  # blocks in maintenance / emergency stop before scheduling
    asn = (md.get("asn_number") or "").strip()
    if not asn:
        raise HTTPException(status_code=400, detail="This dispatch has no ASN Number. Add it in Master Dispatch first.")
    transporter = req.transporter.strip() or (md.get("transporter_name") or "").strip()
    plant = req.plant.strip() or (md.get("plant") or "").strip()
    if not transporter:
        raise HTTPException(status_code=400, detail="Transporter is required (set it in Master Dispatch or override here)")
    if not plant:
        raise HTTPException(status_code=400, detail="Plant is required (set it in Master Dispatch or override here)")
    existing = await latest_ack(req.dispatch_id)
    if existing and existing.get("status") == "Completed":
        raise HTTPException(status_code=400, detail="This dispatch is already acknowledged (Completed) - retry not allowed")
    doc = {
        "dispatch_id": req.dispatch_id, "dispatch_no": md.get("dispatch_no", ""),
        "asn_number": asn, "invoice_number": md.get("invoice_number", ""),
        "transporter": transporter, "plant": plant,
        "company_code": req.company_code.strip() or "TMTL",
        "status": "Processing", "portal_message": "", "ack_date": None, "ack_time": None,
        "screenshots": (existing or {}).get("screenshots", {}),
        "execution_log": (existing or {}).get("execution_log", []),
        "retry_count": (existing or {}).get("retry_count", 0),
        "created_at": (existing or {}).get("created_at", now_iso()), "updated_at": now_iso(),
        "started_by": user["username"],
    }
    if existing:
        await db.vendor_eway_acknowledgement.update_one({"_id": existing["_id"]}, {"$set": doc})
        ack_id = str(existing["_id"])
    else:
        result = await db.vendor_eway_acknowledgement.insert_one({**doc, **(await env_fields())})
        ack_id = str(result.inserted_id)
    if desktop_execution_enabled():
        mode = await get_mode()
        is_test = mode != "live"
        await require_desktop_worker(
            "vendor_eway_acknowledgement", allow_offline_test=True, test_mode=is_test,
        )
        job = await create_automation_job(
            job_type="vendor_eway_acknowledgement",
            payload={"company_code": doc["company_code"], "transporter": doc["transporter"],
                     "plant": doc["plant"], "asn_number": doc["asn_number"]},
            source_record_id=ack_id, created_by=user["username"],
            test_mode=is_test, priority=80,
        )
        await db.vendor_eway_acknowledgement.update_one(
            {"_id": ObjectId(ack_id)},
            {"$set": {"status": "Queued", "desktop_job_id": job["id"], "updated_at": now_iso()}},
        )
        await log_activity(user["username"], "vendor_ack_queued",
                           f"{md.get('dispatch_no')} ASN {asn}", "vendor_ack")
        return {"execution": "desktop", "ack_id": ack_id, "job": job, "status": "Queued"}

    run_id = str(uuid.uuid4())
    run_state.update({"running": True, "run_id": run_id, "ack_id": ack_id,
                      "dispatch_no": md.get("dispatch_no"), "started_at": now_iso()})
    background_tasks.add_task(process_ack, ack_id, run_id, user["username"])
    await log_activity(user["username"], "vendor_ack_run", f"{md.get('dispatch_no')} ASN {asn}", "vendor_ack")
    return {"ack_id": ack_id, "run_id": run_id, "status": "Processing"}


@router.post("/retry/{ack_id}")
async def vendor_ack_retry(ack_id: str, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="A Vendor Ack automation run is already in progress")
    if not ObjectId.is_valid(ack_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    ack = await db.vendor_eway_acknowledgement.find_one({"_id": ObjectId(ack_id)})
    if not ack:
        raise HTTPException(status_code=404, detail="Acknowledgement record not found")
    if ack["status"] == "Completed":
        raise HTTPException(status_code=400, detail="Already acknowledged - retry not allowed")
    await get_mode()  # blocks in maintenance / emergency stop before scheduling
    await db.vendor_eway_acknowledgement.update_one(
        {"_id": ack["_id"]}, {"$set": {"status": "Processing", "updated_at": now_iso()}}
    )
    run_id = str(uuid.uuid4())
    run_state.update({"running": True, "run_id": run_id, "ack_id": ack_id,
                      "dispatch_no": ack.get("dispatch_no"), "started_at": now_iso()})
    background_tasks.add_task(process_ack, ack_id, run_id, user["username"])
    await log_activity(user["username"], "vendor_ack_retry", ack.get("dispatch_no", ack_id), "vendor_ack")
    return {"ack_id": ack_id, "run_id": run_id, "status": "Processing"}


@router.get("/run-status")
async def vendor_ack_run_status(user: dict = Depends(get_current_user)):
    return run_state


@router.get("/acks/{ack_id}")
async def vendor_ack_detail(ack_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(ack_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    ack = await db.vendor_eway_acknowledgement.find_one({"_id": ObjectId(ack_id)})
    if not ack:
        raise HTTPException(status_code=404, detail="Acknowledgement record not found")
    return serialize_ack(ack)


@router.get("/logs")
async def vendor_ack_logs(limit: int = 150, user: dict = Depends(get_current_user)):
    logs = await db.automation_logs.find({"module": "vendor_ack"}, {"_id": 0}).sort("timestamp", -1).to_list(min(limit, 500))
    return list(reversed(logs))


@router.get("/screenshots/{name}")
async def vendor_ack_screenshot(name: str, user: dict = Depends(get_current_user)):
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid screenshot name")
    path = ROOT_DIR / "screenshots" / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(str(path), media_type="image/png")
