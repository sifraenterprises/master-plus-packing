import os
import re
import json
import uuid
import asyncio
import logging
from pathlib import Path
from io import BytesIO
import fitz
from pypdf import PdfReader, PdfWriter
from database import db
from models import utcnow

logger = logging.getLogger(__name__)

PDI_DIR = Path(__file__).parent / "uploads" / "pdi_templates"
PDI_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR = Path(__file__).parent / "uploads" / "pdi_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MASTER_PDF = Path(__file__).parent / "uploads" / "pdi_master_template.pdf"

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
CHUNK_PAGES = 8

PDI_PROMPT = """You are an expert OCR engine reading "FINAL / PRE-DISPATCH INSPECTION REPORT" style quality-template pages.
Each page of the attached PDF belongs to an inspection report template for a part. A template is USUALLY one page, but can span multiple consecutive pages (continuation of the same dimension table).
For EVERY page return ONLY valid JSON (no markdown) in exactly this structure:
{"pages":[{"page":1,"continuation":false,"part_name":"","item_code":"","drg_no":"",
"rows":[{"sr":"01","specified_dimension":"Dim 19.5(\u00b10.20)","method":"Vernier 0.02","freq":"5/Lot","nominal":19.5,"tol_low":-0.20,"tol_high":0.20,"value_type":"dimension"}]}]}
Rules:
- part_name is next to "Part Name :", item_code next to "ITEM CODE :", drg_no next to "DRG. No :".
- "continuation": true ONLY when this page clearly CONTINUES the previous page's template (same part/item code repeated with the dimension table continuing, serial numbers continuing from previous page, or "Page X of Y" with X > 1, or no part header at all). A page that starts a new part's report has continuation false.
- rows: every row of the dimension table on THIS page that contains a specified dimension. Skip empty rows. Keep the printed serial number in "sr".
- specified_dimension, method, freq: copy the printed text as-is.
- nominal: the base numeric value of the dimension. tol_low / tol_high: allowed deviations as signed numbers.
  Examples: "(\u00b10.20)" -> tol_low -0.20, tol_high 0.20 ; "(-0.30)" -> tol_low -0.30, tol_high 0 ; "(+0.30)" -> tol_low 0, tol_high 0.30 ; "(+0.5/-0.2)" -> tol_high 0.5, tol_low -0.2.
- value_type: "visual" when the inspection method is Visual, a gauge GO/NO-GO check, thread check or otherwise not numerically measurable; else "dimension". For visual rows nominal/tol_low/tol_high may be null.
- "page" is the 1-based page number within THIS document."""

run_state = {"running": False, "total": 0, "processed": 0, "imported": 0, "errors": [], "started_at": None, "finished_at": None}

_client = None


def _gemini():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def _parse_json(raw: str) -> dict:
    text = re.sub(r"```(json)?", "", raw or "").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("AI returned no JSON")
    return json.loads(match.group(0))


def _find(words, text, ymin=0.0, ymax=612.0, xmin=0.0, xmax=792.0, nth=1, prefix=False):
    n = 0
    for w in words:
        match = w[4].startswith(text) if prefix else w[4] == text
        if match and ymin <= w[1] <= ymax and xmin <= w[0] <= xmax:
            n += 1
            if n == nth:
                return w
    return None


def page_layout(page) -> dict:
    """Compute cell/anchor geometry from the printed form so handwriting lands in the right boxes."""
    words = page.get_text("words")
    lay = {}
    obs = _find(words, "OBSERVED")
    band = obs[3] if obs else 148.4

    cols, known = [], []
    for n in range(1, 11):
        w = _find(words, str(n), ymin=band - 2, ymax=band + 22)
        c = (w[0] + w[2]) / 2 if w else None
        cols.append(c)
        if c is not None:
            known.append((n - 1, c))
    if len(known) >= 2:
        step = (known[-1][1] - known[0][1]) / (known[-1][0] - known[0][0])
        base = known[0][1] - known[0][0] * step
        cols = [c if c is not None else base + i * step for i, c in enumerate(cols)]
    else:
        cols = [339 + i * 40.7 for i in range(10)]
    lay["cols"] = [round(c, 1) for c in cols]

    rows = []
    for w in words:
        if re.fullmatch(r"\d{2}", w[4]) and w[0] < 100 and band + 10 < w[1] < 470:
            rows.append({"sr": w[4], "y": round((w[1] + w[3]) / 2, 1)})
    rows.sort(key=lambda r: r["y"])
    lay["rows"] = rows
    lay["row_h"] = round(rows[1]["y"] - rows[0]["y"], 1) if len(rows) > 1 else 28.8

    dec = _find(words, "DECISION")
    lay["decision_x"] = round((dec[0] + dec[2]) / 2, 1) if dec else 732.0

    def anchor(key, w, dx=8):
        if w:
            lay[key] = [round(w[2] + dx, 1), round((w[1] + w[3]) / 2, 1)]

    # Header line 1 (REPORT NO. / DATE) — anchor-driven so both form variants work
    date_w = _find(words, "DATE", ymin=10, ymax=band)
    h1y = date_w[1] if date_w else 48.0
    anchor("report_no", _find(words, "NO.", ymin=h1y - 4, ymax=h1y + 6), 10)
    anchor("date", date_w, 12)
    # Header line 2 (Lot Size / Lot No / Challan / MIN / VENDER CODE)
    challan_w = _find(words, "Challan", ymin=h1y, ymax=band)
    h2y = challan_w[1] if challan_w else h1y + 15
    lot2 = _find(words, "Lot", ymin=h2y - 4, ymax=h2y + 6, nth=2)
    min_w = _find(words, "MIN.", ymin=h2y - 4, ymax=h2y + 6)
    vender_w = _find(words, "VENDER", ymin=h2y - 4, ymax=h2y + 6)
    anchor("lot_size", _find(words, "Size", ymin=h2y - 4, ymax=h2y + 6), 10)
    if lot2:
        no_w = _find(words, "No", ymin=h2y - 4, ymax=h2y + 6, xmin=lot2[2])
        anchor("lot_no", no_w or lot2, 10)
    anchor("challan", _find(words, "/Dt.", ymin=h2y - 4, ymax=h2y + 6), 8)
    anchor("min_no", _find(words, "/Dt.", ymin=h2y - 4, ymax=h2y + 6, nth=2), 8)
    code_w = _find(words, "CODE", ymin=h2y - 4, ymax=h2y + 6)
    if code_w:
        anchor("vender_code", code_w, 10)
    # else: CODE-xxxx pre-printed on the form — nothing to write

    def bound(key, next_label):
        a = lay.get(key)
        if a and next_label is not None:
            lay.setdefault("bounds", {})[key] = round(max(30.0, next_label[0] - a[0] - 8), 1)
    bound("report_no", date_w)
    bound("lot_size", lot2)
    bound("lot_no", challan_w)
    bound("challan", min_w)
    bound("min_no", vender_w)

    yes = _find(words, "YES", ymin=h2y + 4, ymax=band, xmin=430)
    no = _find(words, "NO", ymin=h2y + 4, ymax=band, xmin=(yes[2] if yes else 600))
    lay["desc_yes_x"] = round(yes[0] + 1, 1) if yes else 592.0
    lay["desc_no_x"] = round(no[0] + 14, 1) if no else 690.0
    desc_ys = []
    for label in ("1.", "2.", "3."):
        w = _find(words, label, ymin=h2y + 4, ymax=band, xmax=80)
        if w:
            desc_ys.append(round((w[1] + w[3]) / 2, 1))
    if len(desc_ys) == 0:
        desc_ys = [99.0, 113.4, 127.8]
    while len(desc_ys) < 3:
        spacing = desc_ys[1] - desc_ys[0] if len(desc_ys) > 1 else 14.4
        desc_ys.insert(0, round(desc_ys[0] - spacing, 1))
    lay["desc_ys"] = desc_ys[:3]

    insp = _find(words, "INSPECTED", ymin=420, ymax=520)
    appr = _find(words, "APPROVED", ymin=420, ymax=520)
    lay["inspected_by"] = [round(insp[2] + 30, 1), round((insp[1] + insp[3]) / 2, 1)] if insp else [220.0, 484.0]
    lay["approved_by"] = [round(appr[2] + 30, 1), round((appr[1] + appr[3]) / 2, 1)] if appr else [700.0, 484.0]
    iy = insp[1] if insp else 484.0

    anchor("parameters", _find(words, "Parameters", ymin=iy, ymax=iy + 76), 20)
    anchor("id_mark", _find(words, "Location", ymin=iy, ymax=iy + 91), 20)
    note_yes, note_no = [], []
    for nth in (1, 2):
        w = _find(words, "YES", ymin=iy + 20, ymax=iy + 120, nth=nth)
        if w:
            note_yes.append([round(w[2] + 14, 1), round((w[1] + w[3]) / 2, 1)])
        w = _find(words, "NO", ymin=iy + 20, ymax=iy + 120, nth=nth)
        if w:
            note_no.append([round(w[2] + 14, 1), round((w[1] + w[3]) / 2, 1)])
    lay["note_yes"] = note_yes
    lay["note_no"] = note_no
    return lay


async def _gemini_extract(pdf_bytes: bytes) -> list:
    from google.genai import types
    client = _gemini()
    last_err = None
    for attempt in range(3):
        try:
            resp = await client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=[types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"), PDI_PROMPT],
            )
            return _parse_json(resp.text).get("pages") or []
        except Exception as e:
            last_err = e
            await asyncio.sleep(4 * (attempt + 1))
    raise last_err


def _chunk_pdf(reader: PdfReader, start: int, end: int) -> bytes:
    writer = PdfWriter()
    for i in range(start, end):
        writer.add_page(reader.pages[i])
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _save_page_pdf(reader: PdfReader, index: int) -> str:
    path = PDI_DIR / f"page_{index + 1:03d}.pdf"
    writer = PdfWriter()
    writer.add_page(reader.pages[index])
    with open(path, "wb") as f:
        writer.write(f)
    return str(path)


def _clean_row(r: dict, page: int = 1) -> dict:
    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None
    return {
        "sr": str(r.get("sr") or "").strip(),
        "specified_dimension": str(r.get("specified_dimension") or "").strip(),
        "method": str(r.get("method") or "").strip(),
        "freq": str(r.get("freq") or "").strip(),
        "nominal": _num(r.get("nominal")),
        "tol_low": _num(r.get("tol_low")),
        "tol_high": _num(r.get("tol_high")),
        "value_type": "visual" if str(r.get("value_type", "")).lower() == "visual" else "dimension",
        "page": page,
        "remarks": "",
    }


async def save_template_revision(template_doc: dict, saved_by: str):
    snap = {k: template_doc.get(k) for k in
            ("part_name", "item_code", "drg_no", "rows", "layouts", "pages", "source_pdf",
             "mapped_parts", "customer", "plant", "effective_from", "effective_to", "status")}
    await db.pdi_template_revisions.update_one(
        {"template_id": str(template_doc["_id"]), "revision": template_doc.get("revision", 1)},
        {"$set": {**snap, "saved_at": utcnow().isoformat(), "saved_by": saved_by}},
        upsert=True)


async def import_master_pdf(pdf_path: str = None, triggered_by: str = "system",
                            page_start: int = None, page_end: int = None):
    path = Path(pdf_path) if pdf_path else MASTER_PDF
    if not path.exists():
        run_state.update({"running": False, "errors": [f"Master PDF not found at {path}"]})
        return
    reader = PdfReader(str(path))
    total = len(reader.pages)
    s = max(0, (page_start or 1) - 1)
    e = min(total, page_end or total)
    run_state.update({"running": True, "total": e - s, "processed": 0, "imported": 0,
                      "errors": [], "started_at": utcnow().isoformat(), "finished_at": None})
    doc = fitz.open(str(path))
    layouts = {i + 1: page_layout(doc[i]) for i in range(s, e)}
    doc.close()

    sem = asyncio.Semaphore(3)
    chunks = [(st, min(st + CHUNK_PAGES, e)) for st in range(s, e, CHUNK_PAGES)]

    async def process(start, end):
        async with sem:
            try:
                pages = await _gemini_extract(_chunk_pdf(reader, start, end))
            except Exception as e:
                run_state["errors"].append(f"Pages {start + 1}-{end}: {str(e)[:150]}")
                run_state["processed"] += end - start
                return
            by_page = {int(p.get("page", 0)): p for p in pages}
            for i in range(start, end):
                abs_page = i + 1
                data = by_page.get(i - start + 1)
                if not data:
                    run_state["errors"].append(f"Page {abs_page}: no data returned")
                    run_state["processed"] += 1
                    continue
                rows = [_clean_row(r, 1) for r in (data.get("rows") or [])]
                source = _save_page_pdf(reader, i)
                existing = await db.pdi_master_library.find_one({"page_number": abs_page}, {"revision": 1})
                new_rev = (existing or {}).get("revision", 0) + 1
                lay = layouts.get(abs_page, {})
                await db.pdi_master_library.update_one(
                    {"page_number": abs_page},
                    {"$set": {
                        "part_name": str(data.get("part_name") or "").strip(),
                        "item_code": str(data.get("item_code") or "").strip(),
                        "drg_no": str(data.get("drg_no") or "").strip(),
                        "rows": rows, "layouts": [lay], "pages": 1, "revision": new_rev,
                        "source_pdf": source, "updated_at": utcnow().isoformat(),
                    },
                     "$setOnInsert": {"page_number": abs_page, "status": "active",
                                      "mapped_parts": [], "customer": "", "plant": "",
                                      "effective_from": "", "effective_to": "",
                                      "created_at": utcnow().isoformat()}},
                    upsert=True)
                doc_saved = await db.pdi_master_library.find_one({"page_number": abs_page})
                await save_template_revision(doc_saved, triggered_by)
                run_state["imported"] += 1
                run_state["processed"] += 1

    await asyncio.gather(*[process(s, e) for s, e in chunks])
    run_state["running"] = False
    run_state["finished_at"] = utcnow().isoformat()
    await db.pdi_import_runs.insert_one({**{k: v for k, v in run_state.items()},
                                         "triggered_by": triggered_by})
    logger.info("PDI import finished: %s/%s imported, %s errors",
                run_state["imported"], run_state["total"], len(run_state["errors"]))


# ---------- Custom template uploads (data-driven, unlimited templates) ----------

async def process_upload(upload_id: str, triggered_by: str = "admin"):
    """Background OCR of an uploaded PDF: extracts per-page data, groups continuation
    pages into multi-page template drafts and stores them on the upload record."""
    path = UPLOAD_DIR / f"{upload_id}.pdf"
    try:
        reader = PdfReader(str(path))
        total = len(reader.pages)
        sem = asyncio.Semaphore(3)
        chunks = [(s, min(s + CHUNK_PAGES, total)) for s in range(0, total, CHUNK_PAGES)]
        pages_data: dict = {}
        errors: list = []

        async def process(start, end):
            async with sem:
                try:
                    pages = await _gemini_extract(_chunk_pdf(reader, start, end))
                except Exception as e:
                    errors.append(f"Pages {start + 1}-{end}: {str(e)[:150]}")
                    return
                for p in pages:
                    rel = int(p.get("page", 0))
                    if rel:
                        pages_data[start + rel] = p
                await db.pdi_uploads.update_one({"upload_id": upload_id},
                                                {"$inc": {"processed": end - start}})

        await asyncio.gather(*[process(s, e) for s, e in chunks])

        drafts = []
        current = None
        for pno in range(1, total + 1):
            data = pages_data.get(pno) or {}
            is_cont = bool(data.get("continuation")) and current is not None
            if not is_cont:
                if current:
                    drafts.append(current)
                current = {"page_start": pno, "page_end": pno,
                           "part_name": str(data.get("part_name") or "").strip(),
                           "item_code": str(data.get("item_code") or "").strip(),
                           "drg_no": str(data.get("drg_no") or "").strip(),
                           "rows": []}
            else:
                current["page_end"] = pno
                if not current["part_name"]:
                    current["part_name"] = str(data.get("part_name") or "").strip()
            rel_page = pno - current["page_start"] + 1
            current["rows"] += [_clean_row(r, rel_page) for r in (data.get("rows") or [])]
        if current:
            drafts.append(current)

        await db.pdi_uploads.update_one({"upload_id": upload_id}, {"$set": {
            "status": "done", "drafts": drafts, "errors": errors,
            "finished_at": utcnow().isoformat()}})
        logger.info("PDI upload %s processed: %s pages -> %s drafts", upload_id, total, len(drafts))
    except Exception as e:
        logger.exception("PDI upload processing failed")
        await db.pdi_uploads.update_one({"upload_id": upload_id}, {"$set": {
            "status": "failed", "errors": [str(e)[:200]]}})


def extract_template_pdf(upload_id: str, page_start: int, page_end: int):
    """Cut the selected page range into a permanent template source PDF and compute layouts."""
    src = UPLOAD_DIR / f"{upload_id}.pdf"
    if not src.exists():
        raise FileNotFoundError("Upload not found on server")
    reader = PdfReader(str(src))
    total = len(reader.pages)
    page_start = max(1, page_start)
    page_end = min(total, max(page_start, page_end))
    out = PDI_DIR / f"tpl_{uuid.uuid4().hex}.pdf"
    writer = PdfWriter()
    for i in range(page_start - 1, page_end):
        writer.add_page(reader.pages[i])
    with open(out, "wb") as f:
        writer.write(f)
    doc = fitz.open(str(out))
    layouts = [page_layout(doc[i]) for i in range(len(doc))]
    doc.close()
    return str(out), layouts
