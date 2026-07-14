import os
import io
import re
import uuid
import time
import logging
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from bson import ObjectId
from pydantic import BaseModel, Field
from pathlib import Path
from database import db
from models import utcnow
from auth import get_current_user, log_activity
from automation import ASNAutomation, AutomationError, AsnValidationError, DropdownMatchError, SCREENSHOT_DIR

router = APIRouter(prefix="/asn", tags=["asn"])
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent.parent
PDI_DIR = ROOT_DIR / "uploads" / "pdi"
PDI_DIR.mkdir(parents=True, exist_ok=True)
MAX_RETRIES = 3

run_state = {"running": False, "run_id": None, "total": 0, "processed": 0, "current": None, "started_at": None}


class RunRequest(BaseModel):
    ids: list[str] = []


class AsnEditInput(BaseModel):
    po_number: str = ""
    transporter: str = ""
    basic_amount: float = Field(0, ge=0)
    total_amount: float = Field(0, ge=0)


def now_iso():
    return utcnow().isoformat()


async def get_mode():
    setting = await db.settings.find_one({"key": "automation_mode"})
    mode = setting["value"] if setting else os.environ.get("AUTOMATION_MODE", "test")
    return "test" if mode in ("test", "mock") else "live"


def serialize(a: dict) -> dict:
    a = dict(a)
    a["id"] = str(a.pop("_id"))
    return a


def compute_status(doc: dict) -> str:
    ready = all(str(doc.get(k) or "").strip() for k in ("po_number", "invoice_no", "invoice_date", "transporter")) \
        and doc.get("items") and float(doc.get("total_amount") or 0) > 0 \
        and str(doc.get("pdi_file_path") or "").strip()
    return "Ready" if ready else "Draft"


def to_dmy(iso: str) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else (iso or "")


async def append_log(oid, run_id, event, message, level="INFO"):
    entry = {"ts": now_iso(), "event": event, "message": message, "level": level}
    await db.asn_creation.update_one({"_id": oid}, {"$push": {"automation_log": entry}, "$set": {"updated_at": now_iso()}})
    await db.automation_logs.insert_one({"id": str(uuid.uuid4()), "run_id": run_id, "module": "asn",
                                         "event": event, "message": message, "level": level, "timestamp": now_iso()})


async def process_queue(ids: list[str], run_id: str, user: str):
    """Queue processing: one ASN at a time on a single browser session."""
    mode = await get_mode()
    headless = os.environ.get("AUTOMATION_HEADLESS", "true").lower() == "true"
    current_oid = {"v": None}

    async def log(event, message, dispatch_id=None, level="INFO"):
        if current_oid["v"] is not None:
            await append_log(current_oid["v"], run_id, event, message, level)

    bot = ASNAutomation(mode=mode, headless=headless, log=log)
    try:
        if mode == "live":
            bot.require_env()
        await bot.start()
        await bot.login()
        for rec_id in ids:
            oid = ObjectId(rec_id)
            current_oid["v"] = oid
            doc = await db.asn_creation.find_one({"_id": oid})
            if not doc or doc.get("status") == "Completed":
                run_state["processed"] += 1
                continue
            run_state["current"] = doc.get("invoice_no")
            await db.asn_creation.update_one({"_id": oid}, {"$set": {"status": "Processing", "error_message": "", "updated_at": now_iso()}})
            data = {
                "po_number": doc.get("po_number", ""), "invoice_no": doc.get("invoice_no", ""),
                "invoice_date": to_dmy(doc.get("invoice_date", "")),
                "basic_amount": doc.get("basic_amount", 0), "total_amount": doc.get("total_amount", 0),
                "cgst": doc.get("cgst", 0), "sgst": doc.get("sgst", 0), "igst": doc.get("igst", 0),
                "no_of_cases": doc.get("no_of_cases", 0),
                "transporter": doc.get("transporter", ""), "items": doc.get("items", []),
                "pdi_path": doc.get("pdi_file_path", ""),
            }
            status, error_message, asn_number, screenshots = "Failed", "", "", dict(doc.get("screenshots") or {})
            attempts = 0
            try:
                await log("Run Started", f"Creating ASN for invoice {doc.get('invoice_no')} in {mode.upper()} mode by {user}")
                await bot.navigate_to_entry()
                while True:
                    try:
                        result = await bot.run_asn(data)
                        status, asn_number = "Completed", result["asn_number"]
                        if result.get("before_submit"):
                            screenshots["before_submit"] = result["before_submit"]
                        shot = await bot.capture_screenshot(f"asn_success_{rec_id[-6:]}")
                        if shot:
                            screenshots["after_success"] = shot
                        break
                    except (AsnValidationError, DropdownMatchError) as e:
                        error_message = str(e)
                        await log("Error", error_message, level="ERROR")
                        break
                    except AutomationError as e:
                        attempts += 1
                        if attempts < MAX_RETRIES:
                            await log("Retry", f"Attempt {attempts} failed ({e}) - retrying", level="WARN")
                            continue
                        error_message = str(e)
                        await log("Error", f"Failed after {attempts} attempts: {e}", level="ERROR")
                        break
            except Exception as e:
                logger.exception("ASN automation failed")
                error_message = f"Unexpected Error: {type(e).__name__}: {str(e)[:200]}"
                await log("Error", error_message, level="ERROR")
            if status == "Failed":
                shot = await bot.capture_screenshot(f"asn_fail_{rec_id[-6:]}")
                if shot:
                    screenshots["after_failure"] = shot
                page_url, html_file = "", ""
                if bot.page:
                    try:
                        page_url = bot.page.url
                        html_name = f"asn_fail_{rec_id[-6:]}_{uuid.uuid4().hex[:6]}.html"
                        (SCREENSHOT_DIR / html_name).write_text(await bot.page.content())
                        html_file = f"screenshots/{html_name}"
                    except Exception:
                        pass
                await db.asn_creation.update_one({"_id": oid}, {"$set": {"failure_url": page_url, "failure_html": html_file}})
            update = {"status": status, "error_message": error_message, "screenshots": screenshots, "updated_at": now_iso()}
            if status == "Completed":
                update["asn_number"] = asn_number
                update["completed_at"] = now_iso()
                if ObjectId.is_valid(doc.get("master_dispatch_id", "")):
                    await db.master_dispatch.update_one(
                        {"_id": ObjectId(doc["master_dispatch_id"])},
                        {"$set": {"asn_number": asn_number, "status": "ready_for_eway", "updated_at": now_iso()}},
                    )
                    await log("ASN Number Captured", f"{asn_number} linked to Master Dispatch - available to E-Way Bill & Vendor Ack modules", level="SUCCESS")
            await db.asn_creation.update_one({"_id": oid}, {"$set": update})
            run_state["processed"] += 1
    except AutomationError as e:
        logger.error(f"ASN queue aborted: {e}")
        await db.asn_creation.update_many(
            {"_id": {"$in": [ObjectId(i) for i in ids]}, "status": "Processing"},
            {"$set": {"status": "Failed", "error_message": str(e), "updated_at": now_iso()}},
        )
    finally:
        await bot.close()
        run_state["running"] = False
        run_state["current"] = None


# ---------- Import ----------

@router.post("/import")
async def import_from_md(user: dict = Depends(get_current_user)):
    existing_ids = {d["master_dispatch_id"] async for d in db.asn_creation.find({}, {"master_dispatch_id": 1})}
    query = {"$or": [{"asn_number": ""}, {"asn_number": {"$exists": False}}]}
    imported = 0
    async for md in db.master_dispatch.find(query):
        mid = str(md["_id"])
        if mid in existing_ids:
            continue
        doc = {
            "master_dispatch_id": mid, "dispatch_no": md.get("dispatch_no", ""),
            "invoice_no": md.get("invoice_number", ""), "invoice_date": md.get("invoice_date", ""),
            "po_number": md.get("po_number", ""), "supplier_name": "GREWAL ENGINEERING WORKS",
            "plant": md.get("plant", ""), "vehicle_number": md.get("vehicle_number", ""),
            "transporter": md.get("transporter_name", ""),
            "basic_amount": round(float(md.get("invoice_total") or 0) - float(md.get("gst_total") or 0), 2),
            "total_amount": float(md.get("invoice_total") or 0),
            "cgst": float(md.get("cgst") or 0), "sgst": float(md.get("sgst") or 0), "igst": float(md.get("igst") or 0),
            "no_of_cases": int(md.get("boxes") or 0),
            "items": [{"part_number": i.get("part_number", ""), "description": i.get("description", ""),
                       "quantity": i.get("quantity", 0)} for i in (md.get("items") or []) if i.get("part_number")],
            "pdi_file_path": "", "asn_number": "", "error_message": "",
            "automation_log": [], "screenshots": {},
            "created_at": now_iso(), "updated_at": now_iso(), "created_by": user["username"],
        }
        doc["status"] = compute_status(doc)
        await db.asn_creation.insert_one(doc)
        imported += 1
    await log_activity(user["username"], "asn_import", f"{imported} record(s) imported from Master Dispatch", "asn")
    return {"imported": imported}


# ---------- Records ----------

@router.get("/records")
async def asn_records(status: Optional[str] = None, search: Optional[str] = None,
                      page: int = 1, page_size: int = 50, user: dict = Depends(get_current_user)):
    query = {}
    if status and status != "All":
        query["status"] = status
    if search:
        rx = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"invoice_no": rx}, {"po_number": rx}, {"asn_number": rx}, {"dispatch_no": rx}, {"transporter": rx}]
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    total = await db.asn_creation.count_documents(query)
    docs = await db.asn_creation.find(query).sort("created_at", -1).skip((page - 1) * page_size).to_list(page_size)
    return {"items": [serialize(d) for d in docs], "total": total, "page": page,
            "pages": max(1, -(-total // page_size))}


@router.put("/records/{record_id}")
async def edit_asn(record_id: str, body: AsnEditInput, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(record_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    doc = await db.asn_creation.find_one({"_id": ObjectId(record_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="ASN record not found")
    if doc["status"] in ("Processing", "Completed"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {doc['status']} record")
    update = {"po_number": body.po_number.strip(), "transporter": body.transporter.strip(),
              "basic_amount": body.basic_amount, "total_amount": body.total_amount, "updated_at": now_iso()}
    merged = {**doc, **update}
    update["status"] = compute_status(merged)
    await db.asn_creation.update_one({"_id": doc["_id"]}, {"$set": update})
    if body.po_number.strip() and ObjectId.is_valid(doc.get("master_dispatch_id", "")):
        await db.master_dispatch.update_one({"_id": ObjectId(doc["master_dispatch_id"])},
                                            {"$set": {"po_number": body.po_number.strip(), "updated_at": now_iso()}})
    await log_activity(user["username"], "asn_edited", f"{doc.get('invoice_no')} PO {body.po_number}", "asn")
    return serialize(await db.asn_creation.find_one({"_id": doc["_id"]}))


@router.post("/records/{record_id}/pdi")
async def upload_pdi(record_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(record_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    doc = await db.asn_creation.find_one({"_id": ObjectId(record_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="ASN record not found")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDI must be a PDF file")
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF file")
    fid = uuid.uuid4().hex
    path = PDI_DIR / f"{fid}.pdf"
    path.write_bytes(content)
    update = {"pdi_file_path": str(path), "pdi_file_name": file.filename, "updated_at": now_iso()}
    if doc["status"] in ("Draft", "Ready"):
        update["status"] = compute_status({**doc, **update})
    await db.asn_creation.update_one({"_id": doc["_id"]}, {"$set": update})
    await log_activity(user["username"], "asn_pdi_uploaded", f"{doc.get('invoice_no')}: {file.filename}", "asn")
    return {"ok": True, "pdi_file_name": file.filename}


@router.get("/stats")
async def asn_stats(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).date().isoformat()
    return {
        "total": await db.asn_creation.count_documents({}),
        "ready": await db.asn_creation.count_documents({"status": "Ready"}),
        "draft": await db.asn_creation.count_documents({"status": "Draft"}),
        "processing": await db.asn_creation.count_documents({"status": "Processing"}),
        "completed": await db.asn_creation.count_documents({"status": "Completed"}),
        "failed": await db.asn_creation.count_documents({"status": "Failed"}),
        "today": await db.asn_creation.count_documents({"status": "Completed", "completed_at": {"$gte": today}}),
    }


# ---------- Runs (queue: one ASN at a time) ----------

def _start(background_tasks: BackgroundTasks, ids: list[str], user: str):
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="An ASN automation run is already in progress")
    if not ids:
        raise HTTPException(status_code=400, detail="No records to process")
    run_id = str(uuid.uuid4())
    run_state.update({"running": True, "run_id": run_id, "total": len(ids), "processed": 0,
                      "current": None, "started_at": now_iso()})
    background_tasks.add_task(process_queue, ids, run_id, user)
    return {"run_id": run_id, "total": len(ids)}


@router.post("/run")
async def asn_run(req: RunRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    ids = [i for i in req.ids if ObjectId.is_valid(i)]
    result = _start(background_tasks, ids, user["username"])
    await log_activity(user["username"], "asn_run", f"{len(ids)} record(s)", "asn")
    return result


@router.post("/run-ready")
async def asn_run_ready(background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    ids = [str(d["_id"]) async for d in db.asn_creation.find({"status": "Ready"}, {"_id": 1})]
    result = _start(background_tasks, ids, user["username"])
    await log_activity(user["username"], "asn_run_ready", f"{len(ids)} record(s)", "asn")
    return result


@router.post("/retry-failed")
async def asn_retry_failed(background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    ids = [str(d["_id"]) async for d in db.asn_creation.find({"status": "Failed"}, {"_id": 1})]
    result = _start(background_tasks, ids, user["username"])
    await log_activity(user["username"], "asn_retry_failed", f"{len(ids)} record(s)", "asn")
    return result


@router.get("/run-status")
async def asn_run_status(user: dict = Depends(get_current_user)):
    return run_state


@router.get("/export")
async def asn_export(user: dict = Depends(get_current_user)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    docs = await db.asn_creation.find({}).sort("created_at", -1).to_list(5000)
    wb = Workbook()
    ws = wb.active
    ws.title = "ASN Creation"
    ws.append(["Dispatch No", "Invoice No", "Invoice Date", "PO Number", "Transporter", "Plant",
               "Basic Amount", "Total Amount", "Parts", "PDI File", "Status", "ASN Number", "Error"])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(start_color="F97316", end_color="F97316", fill_type="solid")
    for d in docs:
        ws.append([d.get("dispatch_no"), d.get("invoice_no"), d.get("invoice_date"), d.get("po_number"),
                   d.get("transporter"), d.get("plant"), d.get("basic_amount"), d.get("total_amount"),
                   ", ".join(i["part_number"] for i in d.get("items", [])), d.get("pdi_file_name", ""),
                   d.get("status"), d.get("asn_number"), d.get("error_message")])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=asn_creation.xlsx"})


@router.get("/screenshots/{name}")
async def asn_screenshot(name: str, user: dict = Depends(get_current_user)):
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    path = ROOT_DIR / "screenshots" / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    media = "text/html" if name.endswith(".html") else "image/png"
    return FileResponse(str(path), media_type=media)
