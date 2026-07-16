import re
import uuid
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from pymongo import ReturnDocument
from bson import ObjectId
from database import db
from models import utcnow
from auth import get_current_user, require_admin, log_activity
from pdi_models import (PdiTemplate, PdiTemplateCreate, PdiTemplateUpdate, PdiDraftPreview,
                        PdiGenerateInput, PdiReport, PdiBulkAction, PdiBulkReocr)
from pdi_extract import (import_master_pdf, run_state, MASTER_PDF, UPLOAD_DIR,
                         process_upload, extract_template_pdf, save_template_revision)
from pdi_generate import generate_observations, render_report_pdf, REPORT_DIR, resolve_source_pdf

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
async def trigger_import(file: UploadFile = File(None), page_start: int = Form(None),
                         page_end: int = Form(None), user: dict = Depends(require_admin)):
    if run_state["running"]:
        raise HTTPException(status_code=409, detail="An import is already running")
    if file is not None:
        MASTER_PDF.write_bytes(await file.read())
    if not MASTER_PDF.exists():
        raise HTTPException(status_code=404, detail="Master PDI PDF not found on server. Please upload the PDF.")
    _bg(import_master_pdf(triggered_by=user["username"], page_start=page_start, page_end=page_end))
    rng = f" (pages {page_start or 1}-{page_end or 'end'})" if (page_start or page_end) else ""
    await log_activity(user["username"], "pdi_import_started", f"PDI master library import{rng}", "pdi")
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
              "lot_size": "500", "lot_no": "LOT-01", "challan_no_dt": "INV-001",
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

# ---------- Duplicate detection (item_code primary, else part_name + drg_no) ----------

async def _find_duplicate(item_code: str, part_name: str, drg_no: str, exclude_id=None):
    query = None
    if (item_code or "").strip():
        query = {"item_code": item_code.strip()}
    elif (part_name or "").strip() and (drg_no or "").strip():
        query = {"part_name": part_name.strip(), "drg_no": drg_no.strip()}
    if not query:
        return None
    if exclude_id is not None:
        query["_id"] = {"$ne": exclude_id}
    return await db.pdi_master_library.find_one(query)


@router.post("/templates")
async def create_template(payload: PdiTemplateCreate, user: dict = Depends(require_admin)):
    dup = await _find_duplicate(payload.item_code, payload.part_name, payload.drg_no)
    if dup and payload.on_duplicate == "skip":
        return {"skipped": True, "existing_id": str(dup["_id"]),
                "detail": f"Skipped — duplicate of {dup.get('part_name')} ({dup.get('item_code') or dup.get('drg_no')})"}
    if dup and payload.on_duplicate not in ("replace", "keep"):
        raise HTTPException(status_code=409, detail={
            "code": "duplicate", "existing_id": str(dup["_id"]),
            "existing": f"{dup.get('part_name')} · {dup.get('item_code') or '—'} · rev {dup.get('revision', 1)}"})
    try:
        source_pdf, layouts = extract_template_pdf(payload.upload_id, payload.page_start, payload.page_end)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if dup and payload.on_duplicate == "replace":
        updates = {"part_name": payload.part_name, "item_code": payload.item_code, "drg_no": payload.drg_no,
                   "rows": [r.model_dump() for r in payload.rows], "layouts": layouts, "pages": len(layouts),
                   "source_pdf": source_pdf,
                   "mapped_parts": [p.strip() for p in payload.mapped_parts if p.strip()],
                   "customer": payload.customer, "plant": payload.plant,
                   "effective_from": payload.effective_from, "effective_to": payload.effective_to,
                   "revision": dup.get("revision", 1) + 1,
                   "updated_by": user["username"], "updated_at": utcnow().isoformat()}
        await db.pdi_master_library.update_one({"_id": dup["_id"]}, {"$set": updates})
        saved = await db.pdi_master_library.find_one({"_id": dup["_id"]})
        await save_template_revision(saved, user["username"])
        await log_activity(user["username"], "pdi_template_replaced",
                           f"{payload.part_name} · {payload.item_code} · rev {saved.get('revision')}", "pdi")
        return PdiTemplate.from_mongo(saved).model_dump(exclude={"layouts"})
    next_page = await db.pdi_master_library.find_one({}, sort=[("page_number", -1)], projection={"page_number": 1})
    template = PdiTemplate(
        page_number=(next_page or {}).get("page_number", 0) + 1,
        part_name=payload.part_name, item_code=payload.item_code, drg_no=payload.drg_no,
        rows=payload.rows, layouts=layouts, pages=len(layouts), source_pdf=source_pdf,
        revision=1, mapped_parts=[p.strip() for p in payload.mapped_parts if p.strip()],
        customer=payload.customer, plant=payload.plant,
        effective_from=payload.effective_from, effective_to=payload.effective_to,
        status=payload.status if payload.status in ("active", "inactive") else "active",
        created_by=user["username"], updated_by=user["username"])
    result = await db.pdi_master_library.insert_one(template.to_mongo())
    doc = await db.pdi_master_library.find_one({"_id": result.inserted_id})
    await save_template_revision(doc, user["username"])
    await log_activity(user["username"], "pdi_template_created", f"{payload.part_name} · {payload.item_code}", "pdi")
    return PdiTemplate.from_mongo(doc).model_dump()


@router.get("/templates")
async def list_templates(q: str = "", status: str = "", flag: str = "", page: int = 1, limit: int = 25,
                         user: dict = Depends(get_current_user)):
    query = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"part_name": rx}, {"item_code": rx}, {"drg_no": rx},
                        {"mapped_parts": rx}, {"customer": rx}]
    if status in ("active", "inactive"):
        query["status"] = status
    if flag in HEALTH_FLAGS:
        h = await _compute_health()
        query["_id"] = {"$in": [ObjectId(t) for t in h["flags"][flag]]}
    total = await db.pdi_master_library.count_documents(query)
    docs = await db.pdi_master_library.find(query, {"layouts": 0}).sort("page_number", 1) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"total": total, "page": page,
            "items": [PdiTemplate.from_mongo(d).model_dump(exclude={"layouts"}) for d in docs]}


# ---------- Bulk operations, export/import (fixed paths BEFORE /{template_id}) ----------

reocr_state = {"running": False, "total": 0, "processed": 0, "updated": 0,
               "errors": [], "started_at": None, "finished_at": None}


# ---------- Library Health & Integrity ----------

HEALTH_FLAGS = ("missing_item_code", "missing_part_name", "missing_drg_no", "missing_rows",
                "dup_item_code", "dup_item_code_active", "dup_name_drg", "broken_pdf", "never_used")


async def _compute_health() -> dict:
    from pdi_generate import resolve_source_pdf
    docs = await db.pdi_master_library.find(
        {}, {"item_code": 1, "part_name": 1, "drg_no": 1, "rows": 1, "status": 1,
             "source_pdf": 1, "revision": 1}).to_list(10000)
    used_ids = set(await db.pdi_reports.distinct("template_id"))
    by_code, by_code_active, by_name_drg = {}, {}, {}
    flags = {f: [] for f in HEALTH_FLAGS}
    active_ids = set()
    for d in docs:
        tid = str(d["_id"])
        is_active = d.get("status") == "active"
        if is_active:
            active_ids.add(tid)
        code = (d.get("item_code") or "").strip()
        name = (d.get("part_name") or "").strip()
        drg = (d.get("drg_no") or "").strip()
        if not code:
            flags["missing_item_code"].append(tid)
        else:
            by_code.setdefault(code, []).append(tid)
            if is_active:
                by_code_active.setdefault(code, []).append(tid)
        if not name:
            flags["missing_part_name"].append(tid)
        if not drg:
            flags["missing_drg_no"].append(tid)
        if name and drg:
            by_name_drg.setdefault(f"{name}::{drg}", []).append(tid)
        if not d.get("rows"):
            flags["missing_rows"].append(tid)
        path = resolve_source_pdf(d.get("source_pdf", ""))
        if not path or not Path(path).exists():
            flags["broken_pdf"].append(tid)
        if tid not in used_ids:
            flags["never_used"].append(tid)
    dup_codes = {c: ids for c, ids in by_code.items() if len(ids) > 1}
    dup_names = {k: ids for k, ids in by_name_drg.items() if len(ids) > 1}
    flags["dup_item_code"] = [tid for ids in dup_codes.values() for tid in ids]
    flags["dup_item_code_active"] = [tid for ids in by_code_active.values() if len(ids) > 1 for tid in ids]
    flags["dup_name_drg"] = [tid for ids in dup_names.values() for tid in ids]
    # Score reflects quality of the ACTIVE library only
    score_flags = ("missing_item_code", "missing_part_name", "missing_drg_no",
                   "missing_rows", "dup_item_code_active", "broken_pdf")
    issue_ids = set(tid for f in score_flags for tid in flags[f]) & active_ids
    total = len(docs)
    active_total = len(active_ids)
    last_run = await db.pdi_import_runs.find_one({}, sort=[("finished_at", -1)])
    last_check = await db.pdi_integrity_reports.find_one({}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
    return {
        "total": total,
        "active": active_total,
        "inactive": total - active_total,
        "counts": {f: len(flags[f]) for f in HEALTH_FLAGS},
        "flags": flags,
        "duplicate_item_codes": sorted(dup_codes.keys())[:50],
        "duplicate_name_drg": sorted(dup_names.keys())[:50],
        "last_ocr_run": (last_run or {}).get("finished_at") or "",
        "last_ocr_errors": len((last_run or {}).get("errors") or []),
        "last_integrity_check": (last_check or {}).get("created_at", ""),
        "health_score": round(100 * (active_total - len(issue_ids)) / active_total, 1) if active_total else 100.0,
    }


@router.get("/templates/health")
async def templates_health(user: dict = Depends(get_current_user)):
    h = await _compute_health()
    h.pop("flags", None)
    return h


async def run_integrity_check(triggered_by: str, trigger: str) -> dict:
    h = await _compute_health()
    orphan_reports = await db.pdi_reports.count_documents(
        {"template_id": {"$nin": [str(d["_id"]) async for d in
                                  db.pdi_master_library.find({}, {"_id": 1})], "$ne": ""}})
    rev_conflicts = 0
    async for t in db.pdi_master_library.find({}, {"revision": 1}):
        snap = await db.pdi_template_revisions.find_one(
            {"template_id": str(t["_id"]), "revision": t.get("revision", 1)}, {"_id": 1})
        if not snap:
            rev_conflicts += 1
    report = {
        "trigger": trigger, "triggered_by": triggered_by,
        "created_at": utcnow().isoformat(),
        "total": h["total"], "health_score": h["health_score"],
        "issues": {
            "missing_item_code": h["counts"]["missing_item_code"],
            "missing_part_name": h["counts"]["missing_part_name"],
            "missing_drg_no": h["counts"]["missing_drg_no"],
            "missing_rows": h["counts"]["missing_rows"],
            "duplicate_item_codes": h["counts"]["dup_item_code"],
            "duplicate_active_item_codes": h["counts"]["dup_item_code_active"],
            "duplicate_name_drg": h["counts"]["dup_name_drg"],
            "broken_pdf_links": h["counts"]["broken_pdf"],
            "revision_conflicts": rev_conflicts,
            "orphan_reports": orphan_reports,
        },
        "duplicate_item_codes": h["duplicate_item_codes"],
        "duplicate_name_drg": h["duplicate_name_drg"],
        "last_ocr_run": h["last_ocr_run"],
        "last_ocr_errors": h["last_ocr_errors"],
    }
    total_issues = sum(report["issues"].values())
    report["status"] = "clean" if total_issues == 0 else "issues_found"
    await db.pdi_integrity_reports.insert_one({**report})
    report.pop("_id", None)
    await log_activity(triggered_by, "pdi_integrity_check",
                       f"{trigger} — score {report['health_score']}% · {total_issues} issue(s)", "pdi")
    return report


@router.post("/templates/integrity-check")
async def integrity_check(user: dict = Depends(require_admin)):
    return await run_integrity_check(user["username"], "manual")


@router.get("/templates/integrity-reports")
async def integrity_reports(limit: int = 10, user: dict = Depends(get_current_user)):
    docs = await db.pdi_integrity_reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 50))
    return docs


@router.post("/templates/cleanup-duplicates")
async def cleanup_duplicates(user: dict = Depends(require_admin)):
    """Keep newest template (highest page number) active per duplicate item code; deactivate the rest. Never deletes."""
    docs = await db.pdi_master_library.find(
        {"status": "active", "item_code": {"$nin": ["", None]}},
        {"item_code": 1, "page_number": 1, "part_name": 1}).to_list(10000)
    groups = {}
    for d in docs:
        groups.setdefault(d["item_code"].strip(), []).append(d)
    now = utcnow().isoformat()
    deactivated, kept = 0, 0
    for code, items in groups.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda x: x.get("page_number", 0), reverse=True)
        kept += 1
        old_ids = [d["_id"] for d in items[1:]]
        r = await db.pdi_master_library.update_many(
            {"_id": {"$in": old_ids}},
            {"$set": {"status": "inactive", "updated_at": now, "updated_by": user["username"]}})
        deactivated += r.modified_count
    await log_activity(user["username"], "pdi_duplicate_cleanup",
                       f"{kept} duplicate group(s) resolved — kept newest active, {deactivated} old template(s) deactivated (preserved)", "pdi")
    _bg(run_integrity_check(user["username"], "duplicate_cleanup"))
    return {"duplicate_groups": kept, "deactivated": deactivated}


@router.post("/templates/bulk")
async def bulk_templates(payload: PdiBulkAction, user: dict = Depends(require_admin)):
    if payload.action not in ("activate", "deactivate", "delete"):
        raise HTTPException(status_code=400, detail="Unknown bulk action")
    results = {"activated": 0, "deactivated": 0, "deleted": 0, "skipped": 0}
    now = utcnow().isoformat()
    for tid in payload.ids:
        if not ObjectId.is_valid(tid):
            results["skipped"] += 1
            continue
        oid = ObjectId(tid)
        if payload.action in ("activate", "deactivate"):
            status = "active" if payload.action == "activate" else "inactive"
            r = await db.pdi_master_library.update_one(
                {"_id": oid}, {"$set": {"status": status, "updated_at": now, "updated_by": user["username"]}})
            results[payload.action + "d"] += r.modified_count
        else:
            used = await db.pdi_reports.count_documents({"template_id": tid})
            if used:
                await db.pdi_master_library.update_one(
                    {"_id": oid}, {"$set": {"status": "inactive", "updated_at": now, "updated_by": user["username"]}})
                results["deactivated"] += 1
            else:
                d = await db.pdi_master_library.delete_one({"_id": oid})
                await db.pdi_template_revisions.delete_many({"template_id": tid})
                results["deleted"] += d.deleted_count
    await log_activity(user["username"], f"pdi_bulk_{payload.action}",
                       f"{len(payload.ids)} template(s) — {results}", "pdi")
    return results


@router.post("/templates/bulk-reocr")
async def bulk_reocr(payload: PdiBulkReocr, user: dict = Depends(require_admin)):
    if reocr_state["running"]:
        raise HTTPException(status_code=409, detail="A re-OCR run is already in progress")
    if not payload.ids:
        raise HTTPException(status_code=400, detail="No templates selected")
    _bg(_run_bulk_reocr(list(payload.ids), user["username"]))
    await log_activity(user["username"], "pdi_bulk_reocr_started", f"{len(payload.ids)} template(s)", "pdi")
    return {"status": "started", "total": len(payload.ids)}


@router.get("/templates/reocr-status")
async def reocr_status(user: dict = Depends(get_current_user)):
    return reocr_state


async def _run_bulk_reocr(ids: list, username: str):
    from pdi_extract import _gemini_extract, _clean_row
    from pdi_generate import resolve_source_pdf
    reocr_state.update({"running": True, "total": len(ids), "processed": 0, "updated": 0,
                        "errors": [], "started_at": utcnow().isoformat(), "finished_at": None})
    for tid in ids:
        try:
            doc = await db.pdi_master_library.find_one({"_id": ObjectId(tid)})
            if not doc:
                raise ValueError("template not found")
            path = resolve_source_pdf(doc.get("source_pdf", ""))
            if not path or not Path(path).exists():
                raise ValueError("source PDF missing")
            pages = await _gemini_extract(Path(path).read_bytes())
            rows = []
            meta = {}
            for p in pages:
                pg = int(p.get("page") or 1)
                if not meta and (p.get("part_name") or p.get("item_code")):
                    meta = p
                rows.extend([_clean_row(r, pg) for r in (p.get("rows") or [])])
            if not rows:
                raise ValueError("OCR returned no rows")
            updates = {"rows": rows, "revision": doc.get("revision", 1) + 1,
                       "updated_at": utcnow().isoformat(), "updated_by": username}
            for k in ("part_name", "item_code", "drg_no"):
                if not doc.get(k) and meta.get(k):
                    updates[k] = str(meta[k]).strip()
            await db.pdi_master_library.update_one({"_id": doc["_id"]}, {"$set": updates})
            saved = await db.pdi_master_library.find_one({"_id": doc["_id"]})
            await save_template_revision(saved, username)
            reocr_state["updated"] += 1
        except Exception as e:
            reocr_state["errors"].append(f"{tid}: {str(e)[:120]}")
        reocr_state["processed"] += 1
    reocr_state["running"] = False
    reocr_state["finished_at"] = utcnow().isoformat()
    await log_activity(username, "pdi_bulk_reocr_finished",
                       f"{reocr_state['updated']}/{reocr_state['total']} updated, {len(reocr_state['errors'])} errors", "pdi")
    await run_integrity_check(username, "bulk_reocr")


@router.get("/templates/export")
async def export_templates(ids: str = "", user: dict = Depends(require_admin)):
    import zipfile, tempfile, json as _json
    from pdi_generate import resolve_source_pdf
    query = {}
    if ids.strip():
        oids = [ObjectId(i) for i in ids.split(",") if ObjectId.is_valid(i)]
        query = {"_id": {"$in": oids}}
    docs = await db.pdi_master_library.find(query).sort("page_number", 1).to_list(5000)
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    manifest = []
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
        added = set()
        for d in docs:
            path = resolve_source_pdf(d.get("source_pdf", ""))
            pdf_name = Path(path).name if path else ""
            if pdf_name and Path(path).exists() and pdf_name not in added:
                zf.write(path, f"pdfs/{pdf_name}")
                added.add(pdf_name)
            entry = {k: v for k, v in d.items() if k != "_id"}
            entry["id"] = str(d["_id"])
            entry["source_pdf_file"] = pdf_name
            entry.pop("source_pdf", None)
            manifest.append(entry)
        zf.writestr("library.json", _json.dumps({"exported_at": utcnow().isoformat(),
                                                 "exported_by": user["username"],
                                                 "count": len(manifest),
                                                 "templates": manifest}, default=str))
    await log_activity(user["username"], "pdi_library_exported", f"{len(manifest)} template(s)", "pdi")
    fname = f"pdi_template_library_{utcnow().strftime('%Y%m%d_%H%M')}.zip"
    return FileResponse(tmp.name, media_type="application/zip", filename=fname)


@router.post("/templates/import")
async def import_templates(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    import zipfile, tempfile, json as _json
    from pdi_extract import PDI_DIR
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload the exported .zip library file")
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.write(await file.read())
    tmp.close()
    try:
        zf = zipfile.ZipFile(tmp.name)
        data = _json.loads(zf.read("library.json"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid library zip — library.json missing or unreadable")
    imported, updated, skipped, errors = 0, 0, 0, []
    seen_keys = set()
    next_page_doc = await db.pdi_master_library.find_one({}, sort=[("page_number", -1)], projection={"page_number": 1})
    next_page = (next_page_doc or {}).get("page_number", 0) + 1
    now = utcnow().isoformat()
    for t in data.get("templates", []):
        try:
            key = (t.get("item_code") or "").strip() or f"{(t.get('part_name') or '').strip()}::{(t.get('drg_no') or '').strip()}"
            if key in seen_keys:
                skipped += 1
                continue
            seen_keys.add(key)
            pdf_name = t.get("source_pdf_file", "")
            source_pdf = ""
            if pdf_name:
                try:
                    content = zf.read(f"pdfs/{pdf_name}")
                    dest = PDI_DIR / f"imp_{uuid.uuid4().hex}.pdf"
                    dest.write_bytes(content)
                    source_pdf = str(dest)
                except KeyError:
                    pass
            fields = {k: t.get(k) for k in ("part_name", "item_code", "drg_no", "rows", "layouts",
                                            "pages", "mapped_parts", "customer", "plant",
                                            "effective_from", "effective_to", "status") if t.get(k) is not None}
            dup = await _find_duplicate(t.get("item_code", ""), t.get("part_name", ""), t.get("drg_no", ""))
            if dup:
                if source_pdf:
                    fields["source_pdf"] = source_pdf
                fields["revision"] = dup.get("revision", 1) + 1
                fields["updated_at"] = now
                fields["updated_by"] = user["username"]
                await db.pdi_master_library.update_one({"_id": dup["_id"]}, {"$set": fields})
                saved = await db.pdi_master_library.find_one({"_id": dup["_id"]})
                await save_template_revision(saved, user["username"])
                updated += 1
            else:
                if not source_pdf:
                    skipped += 1
                    errors.append(f"{key}: no PDF in zip — skipped")
                    continue
                fields.update({"page_number": next_page, "source_pdf": source_pdf, "revision": 1,
                               "created_at": now, "updated_at": now,
                               "created_by": user["username"], "updated_by": user["username"],
                               "status": fields.get("status") or "active",
                               "mapped_parts": fields.get("mapped_parts") or []})
                next_page += 1
                result = await db.pdi_master_library.insert_one(fields)
                saved = await db.pdi_master_library.find_one({"_id": result.inserted_id})
                await save_template_revision(saved, user["username"])
                imported += 1
        except Exception as e:
            errors.append(f"{t.get('item_code') or t.get('part_name')}: {str(e)[:100]}")
    await log_activity(user["username"], "pdi_library_imported",
                       f"{imported} new, {updated} updated, {skipped} skipped", "pdi")
    _bg(run_integrity_check(user["username"], "import"))
    return {"imported": imported, "updated": updated, "skipped": skipped, "errors": errors[:20]}


async def _template_or_404(template_id: str) -> dict:
    doc = await db.pdi_master_library.find_one({"_id": _oid(template_id, "template")})
    if not doc:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc


@router.post("/templates/{template_id}/duplicate")
async def duplicate_template(template_id: str, user: dict = Depends(require_admin)):
    doc = await _template_or_404(template_id)
    next_page = await db.pdi_master_library.find_one({}, sort=[("page_number", -1)], projection={"page_number": 1})
    now = utcnow().isoformat()
    copy = {k: v for k, v in doc.items() if k != "_id"}
    copy.update({"page_number": (next_page or {}).get("page_number", 0) + 1,
                 "part_name": f"{doc.get('part_name', '')} (Copy)", "item_code": "",
                 "revision": 1, "created_at": now, "updated_at": now,
                 "created_by": user["username"], "updated_by": user["username"]})
    result = await db.pdi_master_library.insert_one(copy)
    saved = await db.pdi_master_library.find_one({"_id": result.inserted_id})
    await save_template_revision(saved, user["username"])
    await log_activity(user["username"], "pdi_template_duplicated",
                       f"{doc.get('part_name')} → {copy['part_name']}", "pdi")
    return PdiTemplate.from_mongo(saved).model_dump(exclude={"layouts"})


@router.post("/templates/{template_id}/revisions/{revision}/restore")
async def restore_revision(template_id: str, revision: int, user: dict = Depends(require_admin)):
    doc = await _template_or_404(template_id)
    snap = await db.pdi_template_revisions.find_one({"template_id": template_id, "revision": revision})
    if not snap:
        raise HTTPException(status_code=404, detail=f"Revision {revision} not found")
    updates = {k: snap.get(k) for k in ("part_name", "item_code", "drg_no", "rows", "layouts", "pages",
                                        "source_pdf", "mapped_parts", "customer", "plant",
                                        "effective_from", "effective_to") if snap.get(k) is not None}
    updates["revision"] = doc.get("revision", 1) + 1
    updates["updated_at"] = utcnow().isoformat()
    updates["updated_by"] = user["username"]
    await db.pdi_master_library.update_one({"_id": doc["_id"]}, {"$set": updates})
    saved = await db.pdi_master_library.find_one({"_id": doc["_id"]})
    await save_template_revision(saved, user["username"])
    await log_activity(user["username"], "pdi_template_restored",
                       f"{doc.get('part_name')} — rev {revision} restored as rev {updates['revision']}", "pdi")
    return PdiTemplate.from_mongo(saved).model_dump(exclude={"layouts"})


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
    updates["updated_by"] = user["username"]
    await db.pdi_master_library.update_one({"_id": doc["_id"]}, {"$set": updates})
    saved = await db.pdi_master_library.find_one({"_id": doc["_id"]})
    if functional_change:
        await save_template_revision(saved, user["username"])
        _bg(run_integrity_check(user["username"], "template_update"))
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
    path = resolve_source_pdf(path)
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="Source PDF not found")
    return FileResponse(path, media_type="application/pdf",
                        filename=f"pdi_template_{doc.get('item_code') or doc.get('page_number')}.pdf",
                        content_disposition_type="inline")


@router.post("/templates/{template_id}/preview")
async def template_sample_preview(template_id: str, user: dict = Depends(get_current_user)):
    doc = await _template_or_404(template_id)
    if not Path(resolve_source_pdf(doc.get("source_pdf", ""))).exists():
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
             "source": report.get("source", "ai"),
             "inspector": report.get("inspector", ""), "approver": report.get("approver", ""),
             "upload_status": "Pending Upload", "last_upload_at": ""}
    await db.master_dispatch.update_one({"_id": oid}, {"$pull": {"documents": {"type": "PDI"}}})
    await db.master_dispatch.update_one({"_id": oid}, {
        "$push": {"documents": entry},
        "$set": {"pdi_report_id": entry["ref_id"], "pdi_report_no": entry["report_no"],
                 "pdi_generated_at": now, "pdi_template_revision": entry["revision"],
                 "pdi_source": entry["source"],
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
    md = await db.master_dispatch.find_one({"_id": oid}, {"pdi_report_id": 1})
    was_active = bool(md) and md.get("pdi_report_id") == str(report["_id"])
    await db.master_dispatch.update_one({"_id": oid}, {
        "$pull": {"documents": {"type": "PDI", "ref_id": str(report["_id"])}},
        "$set": {"updated_at": now}})
    if not was_active:
        return
    await db.master_dispatch.update_one({"_id": oid}, {
        "$unset": {"pdi_report_id": "", "pdi_report_no": "", "pdi_generated_at": "",
                   "pdi_template_revision": "", "pdi_source": "", "pdi_inspector": "", "pdi_approver": "",
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
    if not Path(resolve_source_pdf(template.get("source_pdf", ""))).exists():
        raise HTTPException(status_code=404, detail="Template source page PDF missing. Re-import or replace the template PDF.")

    dispatch = None
    if payload.master_dispatch_id:
        try:
            dispatch = await db.master_dispatch.find_one({"_id": ObjectId(payload.master_dispatch_id)})
        except Exception:
            dispatch = None

    report_no = await _next_report_no()
    sample_count = payload.sample_count if payload.sample_count in (5, 10) else 10
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
        sample_count=sample_count,
        created_by=user["username"],
    )
    observations = generate_observations(template["rows"], n_obs=sample_count)
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
    if doc.get("source") == "manual":
        raise HTTPException(status_code=400, detail="Manual PDI uploads cannot be regenerated")
    template = await _template_at_revision(doc["template_id"], doc.get("template_revision", 1))
    if not template.get("rows") or not Path(resolve_source_pdf(template.get("source_pdf", ""))).exists():
        raise HTTPException(status_code=404, detail="Original template revision unavailable — cannot regenerate")
    observations = generate_observations(template["rows"], n_obs=doc.get("sample_count", 10))
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


# ---------- Manual PDI upload + Active PDI ----------

@router.post("/manual-upload")
async def manual_upload(file: UploadFile = File(...), master_dispatch_id: str = Form(""),
                        part_name: str = Form(""), item_code: str = Form(""),
                        lot_no: str = Form(""), inspector: str = Form(""), approver: str = Form(""),
                        user: dict = Depends(get_current_user)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    dispatch = None
    if master_dispatch_id and ObjectId.is_valid(master_dispatch_id):
        dispatch = await db.master_dispatch.find_one({"_id": ObjectId(master_dispatch_id)})
    pdf_path = REPORT_DIR / f"manual_{uuid.uuid4().hex}.pdf"
    pdf_path.write_bytes(content)
    report_no = await _next_report_no()
    report = PdiReport(
        report_no=report_no, source="manual", status="manual", template_revision=0,
        part_name=part_name, item_code=item_code, lot_no=lot_no,
        inspector=inspector, approver=approver,
        master_dispatch_id=master_dispatch_id if dispatch else "",
        invoice_number=(dispatch or {}).get("invoice_number", ""),
        customer_name=(dispatch or {}).get("customer_name", ""),
        report_date=utcnow().strftime("%d.%m.%Y"),
        pdf_path=str(pdf_path), created_by=user["username"])
    result = await db.pdi_reports.insert_one(report.to_mongo())
    data = report.model_dump()
    data["id"] = str(result.inserted_id)
    if dispatch:
        await _attach_pdi_to_dispatch(master_dispatch_id, {**data})
    await log_activity(user["username"], "pdi_manual_uploaded",
                       f"{report_no} · {file.filename}" + (f" · attached to {report.invoice_number}" if dispatch else ""), "pdi")
    data.pop("pdf_path", None)
    data.pop("observations", None)
    return data


@router.get("/dispatch/{dispatch_id}/reports")
async def dispatch_reports(dispatch_id: str, user: dict = Depends(get_current_user)):
    md = await db.master_dispatch.find_one({"_id": _oid(dispatch_id, "dispatch")}, {"pdi_report_id": 1})
    if not md:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    docs = await db.pdi_reports.find({"master_dispatch_id": dispatch_id}) \
        .sort("created_at", -1).to_list(50)
    return {"active_id": md.get("pdi_report_id", ""),
            "reports": [{"id": str(d["_id"]), "report_no": d.get("report_no", ""),
                         "source": d.get("source", "ai"), "status": d.get("status", ""),
                         "part_name": d.get("part_name", ""), "item_code": d.get("item_code", ""),
                         "inspector": d.get("inspector", ""), "approver": d.get("approver", ""),
                         "template_revision": d.get("template_revision", 1),
                         "created_at": d.get("created_at", "")} for d in docs]}


@router.post("/reports/{report_id}/set-active")
async def set_active_report(report_id: str, user: dict = Depends(get_current_user)):
    doc = await _report_or_404(report_id)
    if not doc.get("master_dispatch_id"):
        raise HTTPException(status_code=400, detail="Report is not linked to a dispatch")
    if not doc.get("pdf_path") or not Path(doc["pdf_path"]).exists():
        raise HTTPException(status_code=404, detail="Report PDF missing — regenerate or re-upload it first")
    await _attach_pdi_to_dispatch(doc["master_dispatch_id"], {**doc, "id": str(doc["_id"])})
    await log_activity(user["username"], "pdi_set_active",
                       f"{doc.get('report_no', '')} set as active PDI", "pdi")
    return {"active": doc.get("report_no", "")}


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
