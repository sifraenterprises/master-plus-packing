import re
import random
from pathlib import Path
import fitz

FONT_DIR = Path(__file__).parent / "fonts"
REPORT_DIR = Path(__file__).parent / "uploads" / "pdi_reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

FONTS = ["Kalam-Regular.ttf", "PatrickHand-Regular.ttf", "Caveat-Regular.ttf"]
BASE_INK = (31 / 255, 79 / 255, 163 / 255)


def _least_count(method: str) -> float:
    m = re.search(r"0\.\d+", method or "")
    if m:
        return float(m.group(0))
    return 0.02


def _decimals(step: float) -> int:
    s = f"{step:.4f}".rstrip("0")
    return max(1, len(s.split(".")[1]) if "." in s else 0)


def _obs_count(freq: str) -> int:
    m = re.match(r"\s*(\d+)", freq or "")
    if m:
        return max(1, min(10, int(m.group(1))))
    return 5


def generate_row_values(row: dict, rng: random.Random) -> list[str]:
    n = _obs_count(row.get("freq", ""))
    nominal = row.get("nominal")
    if row.get("value_type") == "visual" or nominal is None:
        return ["OK"] * n
    tol_low = row.get("tol_low") if row.get("tol_low") is not None else 0.0
    tol_high = row.get("tol_high") if row.get("tol_high") is not None else 0.0
    lo, hi = nominal + min(tol_low, tol_high), nominal + max(tol_low, tol_high)
    if hi <= lo:
        step = _least_count(row.get("method", ""))
        d = _decimals(step)
        return [f"{nominal:.{d}f}"] * n
    step = min(_least_count(row.get("method", "")), (hi - lo) / 2)
    d = _decimals(step)
    band = hi - lo
    inner_lo, inner_hi = lo + band * 0.08, hi - band * 0.08
    mean = rng.uniform(inner_lo + band * 0.15, inner_hi - band * 0.15) if inner_hi - inner_lo > band * 0.3 else (lo + hi) / 2
    sd = band / 7
    vals = []
    for _ in range(n):
        v = rng.gauss(mean, sd)
        v = min(max(v, inner_lo), inner_hi)
        v = round(round(v / step) * step, 6)
        v = min(max(v, lo), hi)
        vals.append(v)
    if n > 2 and len(set(vals)) == 1:
        for i in rng.sample(range(n), max(1, n // 2)):
            nudged = round(vals[i] + rng.choice([-1, 1]) * step, 6)
            if lo <= nudged <= hi:
                vals[i] = nudged
    return [f"{v:.{d}f}" for v in vals]


def generate_observations(rows: list[dict], seed=None) -> list[list[str]]:
    rng = random.Random(seed)
    return [generate_row_values(r, rng) for r in rows]


class HandWriter:
    def __init__(self, page, rng: random.Random):
        self.page = page
        self.rng = rng
        self.fontfile = str(FONT_DIR / rng.choice(FONTS[:2]))
        self.font = fitz.Font(fontfile=self.fontfile)
        j = rng.uniform(-0.03, 0.03)
        self.ink = (max(0, BASE_INK[0] + j), max(0, BASE_INK[1] + j), min(1, BASE_INK[2] + j))

    def text_width(self, text: str, size: float) -> float:
        return self.font.text_length(text, fontsize=size)

    def write(self, text: str, x: float, y: float, size: float = 10.0,
              max_w: float = None, center: bool = False):
        text = str(text or "").strip()
        if not text:
            return
        rng = self.rng
        w = self.text_width(text, size)
        if max_w and w > max_w:
            size = max(6.0, size * max_w / w)
            w = self.text_width(text, size)
        if center:
            x = x - w / 2
        x += rng.uniform(-1.2, 1.2)
        y += rng.uniform(-0.8, 0.8)
        pivot = fitz.Point(x, y)
        matrix = fitz.Matrix(rng.uniform(-1.8, 1.8))
        cx = x
        for ch in text:
            s = size * rng.uniform(0.93, 1.07)
            self.page.insert_text(
                fitz.Point(cx, y + rng.uniform(-0.55, 0.55)), ch,
                fontsize=s, fontname="handwr", fontfile=self.fontfile,
                color=self.ink, morph=(pivot, matrix))
            cx += self.font.text_length(ch, fontsize=s) + rng.uniform(-0.05, 0.4)

    def tick(self, x: float, y: float, size: float = 7.0):
        rng = self.rng
        x += rng.uniform(-1.5, 1.5)
        y += rng.uniform(-1.0, 1.0)
        p1 = fitz.Point(x - size * 0.45 + rng.uniform(-0.5, 0.5), y - size * 0.05 + rng.uniform(-0.4, 0.4))
        p2 = fitz.Point(x - size * 0.08, y + size * 0.4 + rng.uniform(-0.4, 0.4))
        p3 = fitz.Point(x + size * 0.65 + rng.uniform(-0.5, 0.5), y - size * 0.55 + rng.uniform(-0.5, 0.5))
        self.page.draw_line(p1, p2, color=self.ink, width=1.15)
        self.page.draw_line(p2, p3, color=self.ink, width=1.15)


def render_report_pdf(template: dict, report: dict, observations: list[list[str]],
                      out_path: str, seed=None):
    """Overlay handwritten-style entries onto the original template page."""
    rng = random.Random(seed)
    doc = fitz.open(template["source_pdf"])
    page = doc[0]
    hw = HandWriter(page, rng)
    lay = template.get("layout") or {}

    bounds = lay.get("bounds") or {}

    def at(key, text, size=10, max_w=None, dy=0):
        a = lay.get(key)
        if a and text:
            hw.write(text, a[0], a[1] + 3.5 + dy, size=size,
                     max_w=bounds.get(key, max_w))

    at("report_no", report.get("report_no"), 10, max_w=55)
    at("date", report.get("report_date"), 10, max_w=95)
    at("lot_size", report.get("lot_size"), 10, max_w=65)
    at("lot_no", report.get("lot_no"), 10, max_w=90)
    at("challan", report.get("challan_no_dt"), 9.5, max_w=100)
    at("min_no", report.get("min_no_dt"), 9, max_w=58)
    at("vender_code", report.get("vender_code"), 10, max_w=100)

    yes_x = lay.get("desc_yes_x", 592.0)
    for y in lay.get("desc_ys", []):
        hw.tick(yes_x, y)

    cols = lay.get("cols") or []
    row_map = {r["sr"]: r["y"] for r in lay.get("rows") or []}
    row_ys = [r["y"] for r in lay.get("rows") or []]
    rows = template.get("rows") or []
    for idx, trow in enumerate(rows):
        y = row_map.get(trow.get("sr")) or (row_ys[idx] if idx < len(row_ys) else None)
        if y is None:
            continue
        vals = observations[idx] if idx < len(observations) else []
        for c, val in enumerate(vals[:len(cols)]):
            hw.write(val, cols[c], y + 3.2, size=8.6 if len(val) > 4 else 9.4,
                     max_w=36, center=True)
        hw.write("O", lay.get("decision_x", 732.0), y + 3.5, size=10.5, center=True)

    insp, appr = lay.get("inspected_by"), lay.get("approved_by")
    if insp and report.get("inspector"):
        hw.write(report["inspector"], insp[0], insp[1] + 3.5, size=11.5, max_w=200)
    if appr and report.get("approver"):
        hw.write(report["approver"], appr[0], appr[1] + 3.5, size=11.5, max_w=200)

    at("parameters", report.get("parameters_note"), 9.5, max_w=330)
    at("id_mark", report.get("identification_mark"), 9.5, max_w=300)
    for a in lay.get("note_yes") or []:
        hw.tick(a[0], a[1] + 2)

    doc.save(out_path, deflate=True)
    doc.close()
