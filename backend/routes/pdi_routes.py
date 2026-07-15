import re
import uuid
import asyncio
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from pymongo import ReturnDocument
from database import db
from models import utcnow
from auth import get_current_user, require_admin, log_activity
from pdi_models import PdiTemplate, PdiTemplateUpdate, PdiGenerateInput, PdiReport
from pdi_extract import import_master_pdf, run_state, MASTER_PDF
from pdi_generate import generate_observations, render_report_pdf, REPORT_DIR

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pdi", tags=["pdi"])
_tasks = set()


# ---------- Import ----------

@router.post("/import-master")
async def trigger_import(file: UploadFile = File(None), user: dict = Depends(require_admin)):
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="An import is already running")
    if file is not None:
        content = await file.read()
        MASTER_PDF.write_bytes(content)
    if not MASTER_PDF.exists():
        raise HTTPException(status_code=404, detail="Master PDI PDF not found on server. Please upload the PDF.")
    task = asyncio.create_task(import_master_pdf(triggered_by=user["username"]))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    await log_activity(user["username"], "pdi_import_started", "PDI master library import", "pdi")
    return {"status": "started"}


@router.get("/import-status")
async def import_status(user: dict = Depends(get_current_user)):
    templates = await db.pdi_master_library.count_documents({})
    return {**run_state, "templates_in_library": templates}


# ---------- Masters ----------

def _master_routes(kind: str, coll_name: str):
    coll = db[coll_name]

    @router.get(f"/masters/{kind}")
    async def list_names(user: dict = Depends(get_current_user)):
        docs = await coll.find({}, {"_id": 0, "name": 1}).sort("name", 1).to_list(200)
        return [d["name"] for d in docs]

    @router.post(f"/masters/{kind}")
    async def add_name(payload: dict, user: dict = Depends(require_admin)):
        name = str(payload.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name required")
        await coll.update_one({"name": name}, {"$setOnInsert": {"name": name, "created_at": utcnow().isoformat()}}, upsert=True)
        return {"name": name}

    @router.delete(f"/masters/{kind}" + "/{name}")
    async def delete_name(name: str, user: dict = Depends(require_admin)):
        result = await coll.delete_one({"name": name})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"deleted": name}


_master_routes("inspectors", "pdi_inspectors")
_master_routes("approvers", "pdi_approvers")


@router.get("/last-used")
async def last_used(user: dict = Depends(get_current_user)):
    doc = await db.pdi_reports.find_one({"created_by": user["username"]}, sort=[("created_at", -1)])
    return {"inspector": (doc or {}).get("inspector", ""), "approver": (doc or {}).get("approver", "")}


# ---------- Templates ----------

@router.get("/templates")
async def list_templates(q: str = "", page: int = 1, limit: int = 25, user: dict = Depends(get_current_user)):
    query = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query = {"$or": [{"part_name": rx}, {"item_code": rx}, {"drg_no": rx}]}
    total = await db.pdi_master_library.count_documents(query)
    docs = await db.pdi_master_library.find(query).sort("page_number", 1) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"total": total, "page": page,
            "items": [PdiTemplate.from_mongo(d).model_dump() for d in docs]}


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    doc = await _template_or_404(template_id)
    return PdiTemplate.from_mongo(doc).model_dump()


@router.put("/templates/{template_id}")
async def update_template(template_id: str, payload: PdiTemplateUpdate, user: dict = Depends(require_admin)):
    doc = await _template_or_404(template_id)
    updates = payload.model_dump(exclude_none=True)
    updates["updated_at"] = utcnow().isoformat()
    from bson import ObjectId
    await db.pdi_master_library.update_one({"_id": ObjectId(template_id)}, {"$set": updates})
    await log_activity(user["username"], "pdi_template_edited",
                       f"Template p{doc.get('page_number')} · {doc.get('part_name')}", "pdi")
    doc = await db.pdi_master_library.find_one({"_id": ObjectId(template_id)})
    return PdiTemplate.from_mongo(doc).model_dump()


@router.get("/templates/{template_id}/source.pdf")
async def template_source(template_id: str, user: dict = Depends(get_current_user)):
    doc = await _template_or_404(template_id)
    path = doc.get("source_pdf", "")
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="Source page PDF not found")
    return FileResponse(path, media_type="application/pdf",
                        filename=f"pdi_template_p{doc.get('page_number')}.pdf",
                        content_disposition_type="inline")


async def _template_or_404(template_id: str) -> dict:
    from bson import ObjectId
    try:
        oid = ObjectId(template_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid template id")
    doc = await db.pdi_master_library.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc


async def _match_template(identifier: str):
    ident = (identifier or "").strip()
    if not ident:
        return None
    doc = await db.pdi_master_library.find_one({"item_code": ident})
    if doc:
        return doc
    rx = {"$regex": re.escape(ident), "$options": "i"}
    return await db.pdi_master_library.find_one({"$or": [{"item_code": rx}, {"drg_no": rx}, {"part_name": rx}]})


@router.get("/match")
async def match_template(identifier: str, user: dict = Depends(get_current_user)):
    doc = await _match_template(identifier)
    if not doc:
        return {"matched": False, "template": None}
    return {"matched": True, "template": PdiTemplate.from_mongo(doc).model_dump()}


# ---------- Dispatch options for prefill ----------

@router.get("/dispatch-options")
async def dispatch_options(q: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query = {"$or": [{"invoice_number": rx}, {"customer_name": rx}, {"items.part_number": rx}]}
    docs = await db.master_dispatch.find(query, {"invoice_number": 1, "invoice_date": 1,
                                                 "customer_name": 1, "customer_code": 1, "items": 1}) \
        .sort("created_at", -1).limit(20).to_list(20)
    out = []
    for d in docs:
        out.append({"id": str(d["_id"]), "invoice_number": d.get("invoice_number", ""),
                    "invoice_date": d.get("invoice_date", ""), "customer_name": d.get("customer_name", ""),
                    "customer_code": d.get("customer_code", ""),
                    "items": [{"part_number": i.get("part_number", ""), "description": i.get("description", ""),
                               "quantity": i.get("quantity", 0)} for i in d.get("items", [])]})
    return out


# ---------- Generate ----------

async def _next_report_no() -> str:
    doc = await db.counters.find_one_and_update(
        {"_id": "pdi_report"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return f"PDI-{doc['seq']:04d}"


@router.post("/generate")
async def generate_report(payload: PdiGenerateInput, user: dict = Depends(get_current_user)):
    template = None
    if payload.template_id:
        template = await _template_or_404(payload.template_id)
    elif payload.part_identifier:
        template = await _match_template(payload.part_identifier)
    if not template:
        raise HTTPException(status_code=404, detail="No matching PDI template found. Select a template manually from the library.")
    if not template.get("rows"):
        raise HTTPException(status_code=400, detail="Template has no dimension rows. Edit the template first.")
    if not Path(template.get("source_pdf", "")).exists():
        raise HTTPException(status_code=404, detail="Template source page PDF missing. Re-run the master import.")

    dispatch = None
    if payload.master_dispatch_id:
        from bson import ObjectId
        try:
            dispatch = await db.master_dispatch.find_one({"_id": ObjectId(payload.master_dispatch_id)})
        except Exception:
            dispatch = None

    report_no = await _next_report_no()
    report = PdiReport(
        report_no=report_no, template_id=str(template["_id"]),
        page_number=template.get("page_number", 0),
        part_name=template.get("part_name", ""), item_code=template.get("item_code", ""),
        drg_no=template.get("drg_no", ""),
        master_dispatch_id=payload.master_dispatch_id,
        invoice_number=(dispatch or {}).get("invoice_number", ""),
        customer_name=(dispatch or {}).get("customer_name", ""),
        report_date=payload.report_date or utcnow().strftime("%d.%m.%Y"),
        lot_size=payload.lot_size, lot_no=payload.lot_no,
        challan_no_dt=payload.challan_no_dt, min_no_dt=payload.min_no_dt,
        vender_code=payload.vender_code, inspector=payload.inspector, approver=payload.approver,
        parameters_note=payload.parameters_note, identification_mark=payload.identification_mark,
        created_by=user["username"],
    )
    observations = generate_observations(template["rows"])
    report.observations = observations
    pdf_path = REPORT_DIR / f"{uuid.uuid4().hex}.pdf"
    try:
        render_report_pdf(template, report.model_dump(), observations, str(pdf_path))
    except Exception as e:
        logger.exception("PDI render failed")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)[:150]}")
    report.pdf_path = str(pdf_path)
    result = await db.pdi_reports.insert_one(report.to_mongo())
    await log_activity(user["username"], "pdi_generated", f"{report_no} · {report.part_name}", "pdi")
    data = report.model_dump()
    data["id"] = str(result.inserted_id)
    data.pop("pdf_path", None)
    return data


@router.post("/reports/{report_id}/regenerate")
async def regenerate_report(report_id: str, user: dict = Depends(get_current_user)):
    doc = await _report_or_404(report_id)
    template = await _template_or_404(doc["template_id"])
    observations = generate_observations(template["rows"])
    pdf_path = doc.get("pdf_path") or str(REPORT_DIR / f"{uuid.uuid4().hex}.pdf")
    try:
        render_report_pdf(template, doc, observations, pdf_path)
    except Exception as e:
        logger.exception("PDI re-render failed")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)[:150]}")
    from bson import ObjectId
    await db.pdi_reports.update_one({"_id": ObjectId(report_id)}, {"$set": {
        "observations": observations, "pdf_path": pdf_path, "status": "regenerated",
        "updated_at": utcnow().isoformat()}, "$inc": {"regenerated_count": 1}})
    await log_activity(user["username"], "pdi_regenerated", doc.get("report_no", ""), "pdi")
    return {"status": "regenerated", "report_no": doc.get("report_no", "")}


# ---------- Reports history ----------

@router.get("/reports")
async def list_reports(q: str = "", status: str = "", date_from: str = "", date_to: str = "",
                       page: int = 1, limit: int = 25, user: dict = Depends(get_current_user)):
    query = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"invoice_number": rx}, {"part_name": rx}, {"item_code": rx},
                        {"customer_name": rx}, {"lot_no": rx}, {"report_no": rx}, {"drg_no": rx}]
    if status.strip():
        query["status"] = status.strip()
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to + "T23:59:59"
        query["created_at"] = rng
    total = await db.pdi_reports.count_documents(query)
    docs = await db.pdi_reports.find(query).sort("created_at", -1) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    items = []
    for d in docs:
        item = PdiReport.from_mongo(d).model_dump()
        item.pop("pdf_path", None)
        item.pop("observations", None)
        items.append(item)
    return {"total": total, "page": page, "items": items}


async def _report_or_404(report_id: str) -> dict:
    from bson import ObjectId
    try:
        oid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report id")
    doc = await db.pdi_reports.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc


@router.get("/reports/{report_id}/pdf")
async def report_pdf(report_id: str, download: int = 0, user: dict = Depends(get_current_user)):
    doc = await _report_or_404(report_id)
    path = doc.get("pdf_path", "")
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="PDF not found — regenerate the report")
    disposition = "attachment" if download else "inline"
    return FileResponse(path, media_type="application/pdf",
                        filename=f"{doc.get('report_no', 'pdi')}_{doc.get('item_code', '')}.pdf",
                        content_disposition_type=disposition)


@router.delete("/reports/{report_id}")
async def delete_report(report_id: str, user: dict = Depends(require_admin)):
    doc = await _report_or_404(report_id)
    path = doc.get("pdf_path", "")
    if path and Path(path).exists():
        Path(path).unlink()
    from bson import ObjectId
    await db.pdi_reports.delete_one({"_id": ObjectId(report_id)})
    await log_activity(user["username"], "pdi_deleted", doc.get("report_no", ""), "pdi")
    return {"deleted": doc.get("report_no", "")}
