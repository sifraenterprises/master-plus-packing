import os
import re
import json
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
MASTER_PDF = Path(__file__).parent / "uploads" / "pdi_master_template.pdf"

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
CHUNK_PAGES = 8

PDI_PROMPT = """You are an expert OCR engine reading "FINAL / PRE-DISPATCH INSPECTION REPORT" quality-template pages of Grewal Engineering Works.
Each page of the attached PDF is ONE inspection report template for one part.
For EVERY page return ONLY valid JSON (no markdown) in exactly this structure:
{"pages":[{"page":1,"part_name":"","item_code":"","drg_no":"",
"rows":[{"sr":"01","specified_dimension":"Dim 19.5(\u00b10.20)","method":"Vernier 0.02","freq":"5/Lot","nominal":19.5,"tol_low":-0.20,"tol_high":0.20,"value_type":"dimension"}]}]}
Rules:
- part_name is next to "Part Name :", item_code next to "ITEM CODE :", drg_no next to "DRG. No :".
- rows: every row of the dimension table that contains a specified dimension. Skip empty rows. Keep the printed serial number in "sr".
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


def _find(words, text, ymin=0.0, ymax=612.0, xmin=0.0, xmax=792.0, nth=1):
    n = 0
    for w in words:
        if w[4] == text and ymin <= w[1] <= ymax and xmin <= w[0] <= xmax:
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

    date_w = _find(words, "DATE", ymin=40, ymax=64)
    anchor("report_no", _find(words, "NO.", ymin=40, ymax=64), 10)
    anchor("date", date_w, 12)
    lot2 = _find(words, "Lot", ymin=58, ymax=80, nth=2)
    challan_w = _find(words, "Challan", ymin=58, ymax=80)
    min_w = _find(words, "MIN.", ymin=58, ymax=80)
    vender_w = _find(words, "VENDER", ymin=58, ymax=80)
    anchor("lot_size", _find(words, "Size", ymin=58, ymax=80), 10)
    if lot2:
        no_w = _find(words, "No", ymin=58, ymax=80, xmin=lot2[2])
        anchor("lot_no", no_w or lot2, 10)
    anchor("challan", _find(words, "/Dt.", ymin=58, ymax=80), 8)
    anchor("min_no", _find(words, "/Dt.", ymin=58, ymax=80, nth=2), 8)
    anchor("vender_code", _find(words, "CODE", ymin=58, ymax=80), 10)

    def bound(key, next_label):
        a = lay.get(key)
        if a and next_label is not None:
            lay.setdefault("bounds", {})[key] = round(max(30.0, next_label[0] - a[0] - 8), 1)
    bound("report_no", date_w)
    bound("lot_size", lot2)
    bound("lot_no", challan_w)
    bound("challan", min_w)
    bound("min_no", vender_w)

    yes = _find(words, "YES", ymin=80, ymax=105)
    no = _find(words, "NO", ymin=80, ymax=105, xmin=(yes[2] if yes else 600))
    lay["desc_yes_x"] = round((yes[0] + yes[2]) / 2, 1) if yes else 592.0
    lay["desc_no_x"] = round((no[0] + no[2]) / 2, 1) if no else 690.0
    desc_ys = []
    for label in ("1.", "2.", "3."):
        w = _find(words, label, ymin=92, ymax=140, xmax=80)
        if w:
            desc_ys.append(round((w[1] + w[3]) / 2, 1))
    if len(desc_ys) == 0:
        desc_ys = [99.0, 113.4, 127.8]
    while len(desc_ys) < 3:
        spacing = desc_ys[1] - desc_ys[0] if len(desc_ys) > 1 else 14.4
        desc_ys.insert(0, round(desc_ys[0] - spacing, 1))
    lay["desc_ys"] = desc_ys[:3]

    insp = _find(words, "INSPECTED", ymin=440, ymax=500)
    appr = _find(words, "APPROVED", ymin=440, ymax=500)
    lay["inspected_by"] = [round(insp[2] + 30, 1), round((insp[1] + insp[3]) / 2, 1)] if insp else [220.0, 484.0]
    lay["approved_by"] = [round(appr[2] + 30, 1), round((appr[1] + appr[3]) / 2, 1)] if appr else [700.0, 484.0]

    anchor("parameters", _find(words, "Parameters", ymin=500, ymax=560), 20)
    anchor("id_mark", _find(words, "Location", ymin=500, ymax=575), 20)
    note_yes = []
    for nth in (1, 2):
        w = _find(words, "YES", ymin=520, ymax=600, nth=nth)
        if w:
            note_yes.append([round(w[2] + 14, 1), round((w[1] + w[3]) / 2, 1)])
    lay["note_yes"] = note_yes
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


async def import_master_pdf(pdf_path: str = None, triggered_by: str = "system"):
    path = Path(pdf_path) if pdf_path else MASTER_PDF
    if not path.exists():
        run_state.update({"running": False, "errors": [f"Master PDF not found at {path}"]})
        return
    reader = PdfReader(str(path))
    total = len(reader.pages)
    run_state.update({"running": True, "total": total, "processed": 0, "imported": 0,
                      "errors": [], "started_at": utcnow().isoformat(), "finished_at": None})
    doc = fitz.open(str(path))
    layouts = {i + 1: page_layout(doc[i]) for i in range(total)}
    doc.close()

    sem = asyncio.Semaphore(3)
    chunks = [(s, min(s + CHUNK_PAGES, total)) for s in range(0, total, CHUNK_PAGES)]

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
                rows = []
                for r in data.get("rows") or []:
                    def _num(v):
                        try:
                            return float(v)
                        except (TypeError, ValueError):
                            return None
                    rows.append({
                        "sr": str(r.get("sr") or "").strip(),
                        "specified_dimension": str(r.get("specified_dimension") or "").strip(),
                        "method": str(r.get("method") or "").strip(),
                        "freq": str(r.get("freq") or "").strip(),
                        "nominal": _num(r.get("nominal")),
                        "tol_low": _num(r.get("tol_low")),
                        "tol_high": _num(r.get("tol_high")),
                        "value_type": "visual" if str(r.get("value_type", "")).lower() == "visual" else "dimension",
                        "remarks": "",
                    })
                source = _save_page_pdf(reader, i)
                await db.pdi_master_library.update_one(
                    {"page_number": abs_page},
                    {"$set": {
                        "part_name": str(data.get("part_name") or "").strip(),
                        "item_code": str(data.get("item_code") or "").strip(),
                        "drg_no": str(data.get("drg_no") or "").strip(),
                        "rows": rows, "layout": layouts.get(abs_page, {}),
                        "source_pdf": source, "updated_at": utcnow().isoformat(),
                    },
                     "$setOnInsert": {"page_number": abs_page, "status": "active",
                                      "created_at": utcnow().isoformat()}},
                    upsert=True)
                run_state["imported"] += 1
                run_state["processed"] += 1

    await asyncio.gather(*[process(s, e) for s, e in chunks])
    run_state["running"] = False
    run_state["finished_at"] = utcnow().isoformat()
    await db.pdi_import_runs.insert_one({**{k: v for k, v in run_state.items()},
                                         "triggered_by": triggered_by})
    logger.info("PDI import finished: %s/%s imported, %s errors",
                run_state["imported"], total, len(run_state["errors"]))
