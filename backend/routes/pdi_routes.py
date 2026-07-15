import re
import uuid
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse, Response
from pymongo import ReturnDocument
from bson import ObjectId
from database import db
from models import utcnow
from auth import get_current_user, require_admin, log_activity
from pdi_models import (PdiTemplate, PdiTemplateCreate, PdiTemplateUpdate, PdiDraftPreview,
                        PdiGenerateInput, PdiReport)
from pdi_extract import (import_master_pdf, run_state, MASTER_PDF, UPLOAD_DIR,
                         process_upload, extract_template_pdf, save_template_revision)
from pdi_generate import generate_observations, render_report_pdf, REPORT_DIR

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pdi", tags=["pdi"])
_tasks = set()


def _bg(coro):
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _oid(value: str, label: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid {label} id")


# ---------- Master import (120-page master) ----------

@router.post("/import-master")
async def trigger_import(file: UploadFile = File(None), user: dict = Depends(require_admin)):
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="An import is already running")
    if file is not None:
        MASTER_PDF.write_bytes(await file.read())
    if not MASTER_PDF.exists():
        raise HTTPException(status_code=404, detail="Master PDI PDF not found on server. Please upload the PDF.")
    _bg(import_master_pdf(triggered_by=user["username"]))
    await log_activity(user["username"], "pdi_import_started", "PDI master library import", "pdi")
    return {"status": "started"}


@router.get("/import-status")
async def import_status(user: dict = Depends(get_current_user)):
    templates = await db.pdi_master_library.count_documents({})
    return {**run_state, "templates_in_library": templates}


# ---------- Custom template uploads (unlimited, data-driven) ----------

@router.post("/templates/upload")
async def upload_template_pdf(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    upload_id = uuid.uuid4().hex
    content = await file.read()
    (UPLOAD_DIR / f"{upload_id}.pdf").write_bytes(content)
    from pypdf import PdfReader
    try:
        pages = len(PdfReader(str(UPLOAD_DIR / f"{upload_id}.pdf")).pages)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the PDF file")
    await db.pdi_uploads.insert_one({
        "upload_id": upload_id, "filename": file.filename, "pages": pages,
        "status": "processing", "processed": 0, "drafts": [], "errors": [],
        "uploaded_by": user["username"], "created_at": utcnow().isoformat()})
    _bg(process_upload(upload_id, user["username"]))
    await log_activity(user["username"], "pdi_template_uploaded", f"{file.filename} ({pages}p)", "pdi")
    return {"upload_id": upload_id, "pages": pages, "status": "processing"}


@router.get("/uploads/{upload_id}")
async def upload_status(upload_id: str, user: dict = Depends(get_current_user)):
    doc = await db.pdi_uploads.find_one({"upload_id": upload_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found")
    return doc


@router.get("/uploads/{upload_id}/pages.pdf")
async def upload_pages_pdf(upload_id: str, page_start: int = 1, page_end: int = 1,
                           user: dict = Depends(get_current_user)):
    src = UPLOAD_DIR / f"{upload_id}.pdf"
    if not src.exists():
        raise HTTPException(status_code=404, detail="Upload not found")
    from pypdf import PdfReader, PdfWriter
    from io import BytesIO
    reader = PdfReader(str(src))
    writer = PdfWriter()
    for i in range(max(0, page_start - 1), min(len(reader.pages), page_end)):
        writer.add_page(reader.pages[i])
    buf = BytesIO()
    writer.write(buf)
    return Response(buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": "inline; filename=draft.pdf"})


@router.post("/templates/preview-draft")
async def preview_draft(payload: PdiDraftPreview, user: dict = Depends(require_admin)):
    source_pdf, layouts = extract_template_pdf(payload.upload_id, payload.page_start, payload.page_end)
    template = {"source_pdf": source_pdf, "layouts": layouts,
                "rows": [r.model_dump() for r in payload.rows]}
    return _sample_pdf(template)


def _sample_pdf(template: dict) -> Response:
    observations = generate_observations(template.get("rows") or [])
    sample = {"report_no": "PDI-SAMPLE", "report_date": utcnow().strftime("%d.%m.%Y"),
              "lot_size": "500", "lot_no": "LOT-01", "challan_no_dt": "INV-001 / " + utcnow().strftime("%d.%m.%y"),
              "min_no_dt": "", "vender_code": "302235", "inspector": "Sample Inspector",
              "approver": "Sample Approver", "parameters_note": "All dimensions as per drawing",
              "identification_mark": "Sticker on box"}
    out = REPORT_DIR / f"sample_{uuid.uuid4().hex}.pdf"
    try:
        render_report_pdf(template, sample, observations, str(out))
        data = out.read_bytes()
    finally:
        out.unlink(missing_ok=True)
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": "inline; filename=pdi_sample.pdf"})


# ---------- Templates ----------

@router.post("/templates")
async def create_template(payload: PdiTemplateCreate, user: dict = Depends(require_admin)):
    try:
        source_pdf, layouts = extract_template_pdf(payload.upload_id, payload.page_start, payload.page_end)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    next_page = await db.pdi_master_library.find_one({}, sort=[("page_number", -1)], projection={"page_number": 1})
    template = PdiTemplate(
        page_number=(next_page or {}).get("page_number", 0) + 1,
        part_name=payload.part_name, item_code=payload.item_code, drg_no=payload.drg_no,
        rows=payload.rows, layouts=layouts, pages=len(layouts), source_pdf=source_pdf,
        revision=1, mapped_parts=[p.strip() for p in payload.mapped_parts if p.strip()],
        customer=payload.customer, plant=payload.plant,
        effective_from=payload.effective_from, effective_to=payload.effective_to,
        status=payload.status if payload.status in ("active", "inactive") else "active")
    result = await db.pdi_master_library.insert_one(template.to_mongo())
    doc = await db.pdi_master_library.find_one({"_id": result.inserted_id})
    await save_template_revision(doc, user["username"])
    await log_activity(user["username"], "pdi_template_created", f"{payload.part_name} · {payload.item_code}", "pdi")
    return PdiTemplate.from_mongo(doc).model_dump()


@router.get("/templates")
async def list_templates(q: str = "", status: str = "", page: int = 1, limit: int = 25,
                         user: dict = Depends(get_current_user)):
    query = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"part_name": rx}, {"item_code": rx}, {"drg_no": rx},
                        {"mapped_parts": rx}, {"customer": rx}]
    if status in ("active", "inactive"):
        query["status"] = status
    total = await db.pdi_master_library.count_documents(query)
    docs = await db.pdi_master_library.find(query, {"layouts": 0}).sort("page_number", 1) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"total": total, "page": page,
            "items": [PdiTemplate.from_mongo(d).model_dump(exclude={"layouts"}) for d in docs]}


async def _template_or_404(template_id: str) -> dict:
    doc = await db.pdi_master_library.find_one({"_id": _oid(template_id, "template")})
    if not doc:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    return PdiTemplate.from_mongo(await _template_or_404(template_id)).model_dump(exclude={"layouts"})


@router.put("/templates/{template_id}")
async def update_template(template_id: str, payload: PdiTemplateUpdate, user: dict = Depends(require_admin)):
    doc = await _template_or_404(template_id)
    updates = payload.model_dump(exclude_none=True)
    upload_id = updates.pop("upload_id", None)
    page_start = updates.pop("page_start", 1)
    page_end = updates.pop("page_end", 1)
    if upload_id:
        try:
            source_pdf, layouts = extract_template_pdf(upload_id, page_start, page_end)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        updates["source_pdf"] = source_pdf
        updates["layouts"] = layouts
        updates["pages"] = len(layouts)
    if "mapped_parts" in updates:
        updates["mapped_parts"] = [p.strip() for p in updates["mapped_parts"] if p.strip()]
    functional_change = bool(set(updates) - {"status"})
    if functional_change:
        updates["revision"] = doc.get("revision", 1) + 1
    updates["updated_at"] = utcnow().isoformat()
    await db.pdi_master_library.update_one({"_id": doc["_id"]}, {"$set": updates})
    saved = await db.pdi_master_library.find_one({"_id": doc["_id"]})
    if functional_change:
        await save_template_revision(saved, user["username"])
    await log_activity(user["username"], "pdi_template_edited",
                       f"{saved.get('part_name')} · rev {saved.get('revision')}", "pdi")
    return PdiTemplate.from_mongo(saved).model_dump(exclude={"layouts"})


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(require_admin)):
    doc = await _template_or_404(template_id)
    used = await db.pdi_reports.count_documents({"template_id": template_id})
    if used:
        raise HTTPException(status_code=409,
                            detail=f"{used} report(s) were generated from this template — deactivate it instead of deleting.")
    await db.pdi_master_library.delete_one({"_id": doc["_id"]})
    await db.pdi_template_revisions.delete_many({"template_id": template_id})
    await log_activity(user["username"], "pdi_template_deleted", doc.get("part_name", ""), "pdi")
    return {"deleted": doc.get("part_name", "")}


@router.get("/templates/{template_id}/revisions")
async def template_revisions(template_id: str, user: dict = Depends(get_current_user)):
    docs = await db.pdi_template_revisions.find(
        {"template_id": template_id},
        {"_id": 0, "layouts": 0, "rows": 0}).sort("revision", -1).to_list(100)
    return docs


@router.get("/templates/{template_id}/source.pdf")
async def template_source(template_id: str, revision: int = 0, user: dict = Depends(get_current_user)):
    doc = await _template_or_404(template_id)
    path = doc.get("source_pdf", "")
    if revision and revision != doc.get("revision"):
        snap = await db.pdi_template_revisions.find_one({"template_id": template_id, "revision": revision})
        if snap:
            path = snap.get("source_pdf", path)
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="Source PDF not found")
    return FileResponse(path, media_type="application/pdf",
                        filename=f"pdi_template_{doc.get('item_code') or doc.get('page_number')}.pdf",
                        content_disposition_type="inline")


@router.post("/templates/{template_id}/preview")
async def template_sample_preview(template_id: str, user: dict = Depends(get_current_user)):
    doc = await _template_or_404(template_id)
    if not Path(doc.get("source_pdf", "")).exists():
        raise HTTPException(status_code=404, detail="Template source PDF missing")
    return _sample_pdf(doc)


# ---------- Template matching ----------

def _effective_filter():
    today = utcnow().strftime("%Y-%m-%d")
    return [{"$or": [{"effective_from": ""}, {"effective_from": None},
                     {"effective_from": {"$lte": today}}]},
            {"$or": [{"effective_to": ""}, {"effective_to": None},
                     {"effective_to": {"$gte": today}}]}]


async def _match_template(identifier: str, customer: str = ""):
    ident = (identifier or "").strip()
    if not ident:
        return None, []
    base = {"status": "active", "$and": _effective_filter()}
    rx = {"$regex": re.escape(ident), "$options": "i"}
    candidates = []
    for query in ({**base, "mapped_parts": ident},
                  {**base, "item_code": ident},
                  {**base, "$or": [{"mapped_parts": rx}, {"item_code": rx}, {"drg_no": rx}, {"part_name": rx}]}):
        candidates = await db.pdi_master_library.find(query, {"layouts": 0}).to_list(10)
        if candidates:
            break
    if not candidates:
        return None, []
    best = candidates[0]
    if customer and len(candidates) > 1:
        cust = customer.strip().lower()
        for c in candidates:
            tc = (c.get("customer") or "").strip().lower()
            if tc and (tc in cust or cust in tc):
                best = c
                break
        else:
            generic = [c for c in candidates if not (c.get("customer") or "").strip()]
            if generic:
                best = generic[0]
    return best, candidates


@router.get("/match")
async def match_template(identifier: str, customer: str = "", user: dict = Depends(get_current_user)):
    best, candidates = await _match_template(identifier, customer)
    if not best:
        return {"matched": False, "template": None, "alternatives": []}
    return {"matched": True,
            "template": PdiTemplate.from_mongo(best).model_dump(exclude={"layouts"}),
            "alternatives": [PdiTemplate.from_mongo(c).model_dump(exclude={"layouts"})
                             for c in candidates if c["_id"] != best["_id"]][:5]}


# ---------- Inspector / Approver masters ----------

def _people_routes(kind: str, coll_name: str):
    coll = db[coll_name]

    @router.get(f"/masters/{kind}")
    async def list_active(user: dict = Depends(get_current_user)):
        docs = await coll.find({"active": {"$ne": False}}, {"_id": 0, "name": 1}).sort("name", 1).to_list(300)
        return [d["name"] for d in docs]

    @router.get(f"/masters/{kind}/manage")
    async def list_all(user: dict = Depends(require_admin)):
        docs = await coll.find({}).sort("name", 1).to_list(300)
        return [{"id": str(d["_id"]), "name": d["name"], "active": d.get("active", True),
                 "created_at": d.get("created_at", "")} for d in docs]

    @router.post(f"/masters/{kind}")
    async def add(payload: dict, user: dict = Depends(require_admin)):
        name = str(payload.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name required")
        await coll.update_one({"name": name},
                              {"$setOnInsert": {"name": name, "active": True,
                                                "created_at": utcnow().isoformat()}}, upsert=True)
        return {"name": name}

    @router.put(f"/masters/{kind}" + "/{item_id}")
    async def edit(item_id: str, payload: dict, user: dict = Depends(require_admin)):
        updates = {}
        if "name" in payload and str(payload["name"]).strip():
            updates["name"] = str(payload["name"]).strip()
        if "active" in payload:
            updates["active"] = bool(payload["active"])
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        result = await coll.update_one({"_id": _oid(item_id, kind)}, {"$set": updates})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"updated": True}

    @router.delete(f"/masters/{kind}" + "/{item_id}")
    async def remove(item_id: str, user: dict = Depends(require_admin)):
        result = await coll.delete_one({"_id": _oid(item_id, kind)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"deleted": True}


_people_routes("inspectors", "pdi_inspectors")
_people_routes("approvers", "pdi_approvers")


@router.get("/last-used")
async def last_used(user: dict = Depends(get_current_user)):
    doc = await db.pdi_reports.find_one({"created_by": user["username"]}, sort=[("created_at", -1)])
    return {"inspector": (doc or {}).get("inspector", ""), "approver": (doc or {}).get("approver", "")}


# ---------- Dispatch options for auto-population ----------

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
        slips = await db.packing_slips.find({"invoice_number": d.get("invoice_number", "")},
                                            {"_id": 0, "lot_number": 1}).sort("created_at", -1).to_list(20)
        lots = list(dict.fromkeys([s["lot_number"] for s in slips if s.get("lot_number")]))
        out.append({"id": str(d["_id"]), "invoice_number": d.get("invoice_number", ""),
                    "invoice_date": d.get("invoice_date", ""), "customer_name": d.get("customer_name", ""),
                    "customer_code": d.get("customer_code", ""),
                    "total_quantity": sum(i.get("quantity", 0) for i in d.get("items", [])),
                    "lot_numbers": lots,
                    "items": [{"part_number": i.get("part_number", ""), "description": i.get("description", ""),
                               "quantity": i.get("quantity", 0)} for i in d.get("items", [])]})
    return out


# ---------- Master Dispatch document attachment (single source of truth) ----------

async def _attach_pdi_to_dispatch(dispatch_id: str, report: dict):
    if not dispatch_id or not ObjectId.is_valid(dispatch_id):
        return
    oid = ObjectId(dispatch_id)
    now = utcnow().isoformat()
    entry = {"type": "PDI", "ref_id": str(report.get("id") or report.get("_id")),
             "report_no": report.get("report_no", ""), "file_path": report.get("pdf_path", ""),
             "generated_at": now, "revision": report.get("template_revision", 1),
             "inspector": report.get("inspector", ""), "approver": report.get("approver", ""),
             "upload_status": "Pending Upload", "last_upload_at": ""}
    await db.master_dispatch.update_one({"_id": oid}, {"$pull": {"documents": {"type": "PDI"}}})
    await db.master_dispatch.update_one({"_id": oid}, {
        "$push": {"documents": entry},
        "$set": {"pdi_report_id": entry["ref_id"], "pdi_report_no": entry["report_no"],
                 "pdi_generated_at": now, "pdi_template_revision": entry["revision"],
                 "pdi_inspector": entry["inspector"], "pdi_approver": entry["approver"],
                 "pdi_upload_status": "Pending Upload", "pdi_last_upload_at": "",
                 "updated_at": now}})
    asn = await db.asn_creation.find_one({"master_dispatch_id": dispatch_id})
    if asn:
        from routes.asn_routes import compute_status
        update = {"pdi_file_path": report.get("pdf_path", ""),
                  "pdi_file_name": f"{entry['report_no']}.pdf", "updated_at": now}
        if asn.get("status") in ("Draft", "Ready"):
            update["status"] = compute_status({**asn, **update})
        await db.asn_creation.update_one({"_id": asn["_id"]}, {"$set": update})


async def _detach_pdi_from_dispatch(dispatch_id: str, report: dict):
    if not dispatch_id or not ObjectId.is_valid(dispatch_id):
        return
    oid = ObjectId(dispatch_id)
    now = utcnow().isoformat()
    await db.master_dispatch.update_one({"_id": oid}, {
        "$pull": {"documents": {"type": "PDI", "ref_id": str(report["_id"])}},
        "$unset": {"pdi_report_id": "", "pdi_report_no": "", "pdi_generated_at": "",
                   "pdi_template_revision": "", "pdi_inspector": "", "pdi_approver": "",
                   "pdi_upload_status": "", "pdi_last_upload_at": ""},
        "$set": {"updated_at": now}})
    await db.asn_creation.update_one(
        {"master_dispatch_id": dispatch_id, "pdi_file_path": report.get("pdf_path", "")},
        {"$set": {"pdi_file_path": "", "pdi_file_name": "", "updated_at": now}})


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
        template, _ = await _match_template(payload.part_identifier)
    if not template:
        raise HTTPException(status_code=404, detail="No matching PDI template found. Select a template manually from the library.")
    if not template.get("rows"):
        raise HTTPException(status_code=400, detail="Template has no dimension rows. Edit the template first.")
    if not Path(template.get("source_pdf", "")).exists():
        raise HTTPException(status_code=404, detail="Template source page PDF missing. Re-import or replace the template PDF.")

    dispatch = None
    if payload.master_dispatch_id:
        try:
            dispatch = await db.master_dispatch.find_one({"_id": ObjectId(payload.master_dispatch_id)})
        except Exception:
            dispatch = None

    report_no = await _next_report_no()
    report = PdiReport(
        report_no=report_no, template_id=str(template["_id"]),
        template_revision=template.get("revision", 1),
        page_number=template.get("page_number", 0),
        part_name=payload.part_name or template.get("part_name", ""),
        item_code=payload.item_code or template.get("item_code", ""),
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
    await log_activity(user["username"], "pdi_generated",
                       f"{report_no} · {report.part_name} · rev {report.template_revision}", "pdi")
    data = report.model_dump()
    data["id"] = str(result.inserted_id)
    await _attach_pdi_to_dispatch(payload.master_dispatch_id, {**data})
    data.pop("pdf_path", None)
    return data


async def _report_or_404(report_id: str) -> dict:
    doc = await db.pdi_reports.find_one({"_id": _oid(report_id, "report")})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc


async def _template_at_revision(template_id: str, revision: int) -> dict:
    snap = await db.pdi_template_revisions.find_one({"template_id": template_id, "revision": revision})
    if snap:
        current = await db.pdi_master_library.find_one({"_id": _oid(template_id, "template")}, {"_id": 1})
        snap["_id"] = (current or {}).get("_id")
        return snap
    return await _template_or_404(template_id)


@router.post("/reports/{report_id}/regenerate")
async def regenerate_report(report_id: str, user: dict = Depends(get_current_user)):
    doc = await _report_or_404(report_id)
    template = await _template_at_revision(doc["template_id"], doc.get("template_revision", 1))
    if not template.get("rows") or not Path(template.get("source_pdf", "")).exists():
        raise HTTPException(status_code=404, detail="Original template revision unavailable — cannot regenerate")
    observations = generate_observations(template["rows"])
    pdf_path = doc.get("pdf_path") or str(REPORT_DIR / f"{uuid.uuid4().hex}.pdf")
    try:
        render_report_pdf(template, doc, observations, pdf_path)
    except Exception as e:
        logger.exception("PDI re-render failed")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)[:150]}")
    await db.pdi_reports.update_one({"_id": doc["_id"]}, {"$set": {
        "observations": observations, "pdf_path": pdf_path, "status": "regenerated",
        "updated_at": utcnow().isoformat()}, "$inc": {"regenerated_count": 1}})
    if doc.get("master_dispatch_id"):
        md = await db.master_dispatch.find_one(
            {"_id": ObjectId(doc["master_dispatch_id"])}, {"pdi_report_id": 1}
        ) if ObjectId.is_valid(doc.get("master_dispatch_id", "")) else None
        if md and md.get("pdi_report_id") == str(doc["_id"]):
            await _attach_pdi_to_dispatch(doc["master_dispatch_id"],
                                          {**doc, "id": str(doc["_id"]), "pdf_path": pdf_path})
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
                        {"customer_name": rx}, {"lot_no": rx}, {"report_no": rx}, {"drg_no": rx},
                        {"inspector": rx}, {"approver": rx}]
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
    await _detach_pdi_from_dispatch(doc.get("master_dispatch_id", ""), doc)
    await db.pdi_reports.delete_one({"_id": doc["_id"]})
    await log_activity(user["username"], "pdi_deleted", doc.get("report_no", ""), "pdi")
    return {"deleted": doc.get("report_no", "")}
