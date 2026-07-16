import os
import json
import re
import uuid
import asyncio
import logging
from io import BytesIO
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pymongo import ReturnDocument
from database import db
from models import utcnow
from md_models import MasterDispatch, MDItem

logger = logging.getLogger(__name__)

MD_UPLOAD_DIR = Path(__file__).parent / "uploads" / "master_dispatch"
MD_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
CHUNK_PAGES = 25
CONF_THRESHOLD = 90

HEADER_TEXT = ["customer_name", "customer_code", "gstin", "invoice_number", "invoice_date",
               "po_number", "po_date", "gross_weight", "net_weight", "vehicle_number",
               "lr_number", "transporter_name", "eway_bill_number", "irn", "ack_number",
               "asn_number", "plant"]
HEADER_NUM = ["cgst", "sgst", "igst", "gst_total", "invoice_total"]

EXTRACTION_PROMPT = """You are an expert OCR engine for Indian GST tax invoices of an engineering company.
The attached PDF may contain ONE invoice or MULTIPLE separate invoices (each invoice may span one or more consecutive pages). Duplicate copies of the SAME invoice number (e.g. "Original for Recipient", "Duplicate for Transporter") are ONE invoice.
Detect every distinct invoice with its page range, then extract its data.
Return ONLY valid JSON (no markdown, no explanation) in exactly this structure:
{"invoices":[{"page_start":1,"page_end":1,
"customer_name":"","customer_code":"","gstin":"",
"invoice_number":"","invoice_date":"YYYY-MM-DD","po_number":"","po_date":"YYYY-MM-DD",
"items":[{"part_number":"","description":"","hsn":"","quantity":0,"unit":"","rate":0,"amount":0}],
"boxes":0,"gross_weight":"","net_weight":"",
"vehicle_number":"","lr_number":"","transporter_name":"",
"cgst":0,"sgst":0,"igst":0,"gst_total":0,"invoice_total":0,
"eway_bill_number":"","irn":"","ack_number":"","asn_number":"","plant":"",
"confidence":{"customer_name":95,"customer_code":95,"gstin":95,"invoice_number":95,"invoice_date":95,"po_number":95,"po_date":95,"boxes":95,"gross_weight":95,"net_weight":95,"vehicle_number":95,"lr_number":95,"transporter_name":95,"cgst":95,"sgst":95,"igst":95,"gst_total":95,"invoice_total":95,"eway_bill_number":95,"irn":95,"ack_number":95,"asn_number":95,"plant":95,"items":95}}]}
Rules:
- "gstin" is the CUSTOMER/buyer GSTIN (Bill To / Ship To party), not the seller's own GSTIN.
- "asn_number" is the ASN (Advance Shipping Notice) number if printed on the document, else "".
- "plant" is the receiving plant / consignee plant name-code if printed (e.g. "TMTL - Production - Bhopal-700"), else "".
- Quantities, rates, amounts and taxes must be plain numbers. Dates in YYYY-MM-DD. Missing text -> "", missing numbers -> 0.
- "confidence" is your certainty 0-100 per field (100 = clearly printed and read; below 90 = unclear, guessed or absent).
- Include EVERY line item of each invoice in "items".
- page_start/page_end are 1-based page numbers within THIS document."""

_client = None
_tasks = set()


def _gemini():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def _s(v):
    return str(v).strip() if v is not None else ""


def _f(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _i(v):
    try:
        return int(float(v or 0))
    except (TypeError, ValueError):
        return 0


def _parse_json(raw: str) -> dict:
    text = re.sub(r"```(json)?", "", raw or "").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("AI returned no JSON")
    return json.loads(match.group(0))


async def _gemini_extract(pdf_bytes: bytes) -> list:
    from google.genai import types
    client = _gemini()
    last_err = None
    for attempt in range(2):
        try:
            resp = await client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=[types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"), EXTRACTION_PROMPT],
            )
            return _parse_json(resp.text).get("invoices") or []
        except Exception as e:
            last_err = e
            if attempt == 0:
                await asyncio.sleep(3)
    raise last_err


def _chunk_pdf(reader: PdfReader, start: int, end: int) -> bytes:
    writer = PdfWriter()
    for p in range(start, end):
        writer.add_page(reader.pages[p])
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


async def extract_invoices(pdf_bytes: bytes, num_pages: int) -> list:
    """Detect and extract all invoices; handles large PDFs in page chunks."""
    if num_pages <= CHUNK_PAGES:
        return await _gemini_extract(pdf_bytes)
    reader = PdfReader(BytesIO(pdf_bytes))
    invoices = []
    for offset in range(0, num_pages, CHUNK_PAGES):
        chunk_end = min(offset + CHUNK_PAGES, num_pages)
        chunk = _chunk_pdf(reader, offset, chunk_end)
        for inv in await _gemini_extract(chunk):
            inv["page_start"] = _i(inv.get("page_start", 1)) + offset
            inv["page_end"] = _i(inv.get("page_end", 1)) + offset
            invoices.append(inv)
    return invoices


def split_pdf(source_path: Path, page_start: int, page_end: int, num_pages: int, out_dir: Path = None):
    """Returns (file_id, size, pages) for the split PDF, or None if it spans the whole doc."""
    s = max(1, min(page_start or 1, num_pages))
    e = max(s, min(page_end or s, num_pages))
    if s == 1 and e == num_pages:
        return None
    reader = PdfReader(str(source_path))
    writer = PdfWriter()
    for p in range(s - 1, e):
        writer.add_page(reader.pages[p])
    fid = str(uuid.uuid4())
    out = (out_dir or MD_UPLOAD_DIR) / f"{fid}.pdf"
    with open(out, "wb") as fh:
        writer.write(fh)
    return fid, out.stat().st_size, e - s + 1


async def next_md_no() -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": "master_dispatch"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return f"GEW-MD-{counter['seq']:05d}"


def normalize_eway(v: str) -> str:
    digits = re.sub(r"\D", "", v or "")
    return digits if len(digits) == 12 else (v or "").strip()


def build_record(inv: dict, created_by: str) -> MasterDispatch:
    confidence = {k: max(0, min(100, _i(v))) for k, v in (inv.get("confidence") or {}).items()}
    low = [k for k, v in confidence.items() if v < CONF_THRESHOLD]
    items = [MDItem(
        part_number=_s(it.get("part_number")), description=_s(it.get("description")),
        hsn=_s(it.get("hsn")), quantity=_f(it.get("quantity")), unit=_s(it.get("unit")),
        rate=_f(it.get("rate")), amount=_f(it.get("amount")),
    ) for it in (inv.get("items") or [])]
    record = MasterDispatch(
        **{k: _s(inv.get(k)) for k in HEADER_TEXT},
        **{k: _f(inv.get(k)) for k in HEADER_NUM},
        boxes=_i(inv.get("boxes")),
        items=items,
        status="pending",
        verified=False,
        ocr_status="extracted",
        confidence=confidence,
        low_confidence_fields=low,
        created_by=created_by,
    )
    record.eway_bill_number = normalize_eway(record.eway_bill_number)
    return record


async def _log(batch_id: str, level: str, message: str):
    await db.md_batches.update_one(
        {"batch_id": batch_id},
        {"$push": {"logs": {"ts": utcnow().isoformat(), "level": level, "message": message}},
         "$set": {"updated_at": utcnow().isoformat()}},
    )


async def _set_file(batch_id: str, file_id: str, fields: dict):
    await db.md_batches.update_one(
        {"batch_id": batch_id, "files.file_id": file_id},
        {"$set": {f"files.$.{k}": v for k, v in fields.items()}},
    )


async def process_file(batch_id: str, file_doc: dict, created_by: str) -> bool:
    file_id = file_doc["file_id"]
    name = file_doc.get("name", file_id)
    from environment import find_upload
    path = find_upload(MD_UPLOAD_DIR, f"{file_id}.pdf") or MD_UPLOAD_DIR / f"{file_id}.pdf"
    await _set_file(batch_id, file_id, {"status": "processing", "error": ""})
    await db.md_uploaded_invoices.update_one({"file_id": file_id}, {"$set": {"status": "processing"}})
    await _log(batch_id, "info", f"Processing {name}…")
    try:
        pdf_bytes = path.read_bytes()
        num_pages = len(PdfReader(BytesIO(pdf_bytes)).pages)
        invoices = await extract_invoices(pdf_bytes, num_pages)
        if not invoices:
            raise ValueError("No invoices detected in this PDF")
        record_ids = []
        for inv in invoices:
            from environment import env_upload_dir
            split = split_pdf(path, _i(inv.get("page_start", 1)), _i(inv.get("page_end", 1)), num_pages,
                              out_dir=await env_upload_dir(MD_UPLOAD_DIR))
            split_file_id = file_id
            if split:
                split_file_id, split_size, split_pages = split
                await db.md_uploaded_invoices.insert_one({
                    "file_id": split_file_id, "kind": "split", "original_name": f"{name} (p{inv.get('page_start')}-{inv.get('page_end')})",
                    "size": split_size, "pages": split_pages, "batch_id": batch_id,
                    "source_file_id": file_id, "status": "done",
                    "uploaded_by": created_by, "uploaded_at": utcnow().isoformat(),
                })
            record = build_record(inv, created_by)
            record.dispatch_no = await next_md_no()
            record.source_file_id = file_id
            record.split_file_id = split_file_id
            record.batch_id = batch_id
            record.page_start = _i(inv.get("page_start", 1))
            record.page_end = _i(inv.get("page_end", 1))
            result = await db.master_dispatch.insert_one(record.to_mongo())
            record_ids.append(str(result.inserted_id))
            await db.md_ocr_logs.insert_one({
                "batch_id": batch_id, "file_id": file_id, "split_file_id": split_file_id,
                "record_id": str(result.inserted_id), "dispatch_no": record.dispatch_no,
                "model": GEMINI_MODEL, "status": "success", "raw_json": inv,
                "low_confidence_fields": record.low_confidence_fields,
                "created_at": utcnow().isoformat(),
            })
        await _set_file(batch_id, file_id, {"status": "done", "invoices_found": len(invoices), "record_ids": record_ids})
        await db.md_uploaded_invoices.update_one(
            {"file_id": file_id}, {"$set": {"status": "done", "invoices_found": len(invoices)}}
        )
        await _log(batch_id, "success", f"{name}: {len(invoices)} invoice(s) extracted → {len(record_ids)} record(s) created")
        return True
    except Exception as e:
        logger.exception(f"Master dispatch OCR failed for {name}")
        err = str(e)[:400]
        await _set_file(batch_id, file_id, {"status": "failed", "error": err})
        await db.md_uploaded_invoices.update_one({"file_id": file_id}, {"$set": {"status": "failed", "error": err}})
        await db.md_ocr_logs.insert_one({
            "batch_id": batch_id, "file_id": file_id, "model": GEMINI_MODEL,
            "status": "error", "error": err, "created_at": utcnow().isoformat(),
        })
        await _log(batch_id, "error", f"{name}: {err}")
        return False


async def process_batch(batch_id: str):
    batch = await db.md_batches.find_one({"batch_id": batch_id})
    if not batch:
        return
    pending = [f for f in batch["files"] if f["status"] == "queued"]
    sem = asyncio.Semaphore(2)

    async def worker(f):
        async with sem:
            ok = await process_file(batch_id, f, batch["created_by"])
            inc = {"processed_files": 1}
            if not ok:
                inc["failed_files"] = 1
            await db.md_batches.update_one({"batch_id": batch_id}, {"$inc": inc})

    await asyncio.gather(*[worker(f) for f in pending])
    fresh = await db.md_batches.find_one({"batch_id": batch_id})
    failed = sum(1 for f in fresh["files"] if f["status"] == "failed")
    created = sum(f.get("invoices_found") or 0 for f in fresh["files"] if f["status"] == "done")
    status = "completed_with_errors" if failed else "completed"
    await db.md_batches.update_one(
        {"batch_id": batch_id},
        {"$set": {"status": status, "failed_files": failed, "invoices_created": created,
                  "updated_at": utcnow().isoformat()}},
    )
    await _log(batch_id, "info", f"Batch finished: {created} record(s) created, {failed} file(s) failed")


def launch_batch(batch_id: str):
    task = asyncio.create_task(process_batch(batch_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
