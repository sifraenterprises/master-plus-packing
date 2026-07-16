"""Extended PDI backend tests: uploads, revisions, dispatch-options, masters manage, delete-in-use."""
import io
import os
import time
import pytest
import requests
from pathlib import Path
from pypdf import PdfReader, PdfWriter

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

MASTER_PDF = Path("/app/backend/uploads/pdi_master_template.pdf")


@pytest.fixture(scope="module")
def admin_h():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"}, timeout=20)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def dispatch_h():
    r = requests.post(f"{API}/auth/login", json={"username": "dispatch", "password": "5@Grewal"}, timeout=20)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _small_pdf_bytes(num_pages: int = 2) -> bytes:
    reader = PdfReader(str(MASTER_PDF))
    writer = PdfWriter()
    for i in range(num_pages):
        writer.add_page(reader.pages[i])
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


# ---------------- Upload flow ----------------

@pytest.fixture(scope="module")
def upload_result(admin_h):
    pdf_bytes = _small_pdf_bytes(2)
    files = {"file": ("test_upload.pdf", pdf_bytes, "application/pdf")}
    r = requests.post(f"{API}/pdi/templates/upload", files=files, headers=admin_h, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    upload_id = j["upload_id"]
    assert j["pages"] == 2

    # Poll status up to ~90 seconds
    deadline = time.time() + 120
    doc = None
    while time.time() < deadline:
        rp = requests.get(f"{API}/pdi/uploads/{upload_id}", headers=admin_h, timeout=15)
        assert rp.status_code == 200
        doc = rp.json()
        if doc.get("status") in ("done", "error"):
            break
        time.sleep(3)
    if doc and doc.get("status") == "processing":
        pytest.skip(f"template OCR stuck processing (likely Gemini quota): {doc.get('errors')}")
    if doc and doc.get("status") == "error" and any("429" in str(e) or "quota" in str(e).lower() for e in doc.get("errors", [])):
        pytest.skip("Gemini quota exhausted")
    assert doc and doc.get("status") == "done", f"upload not done: {doc}"
    assert len(doc.get("drafts", [])) >= 1
    return {"upload_id": upload_id, "doc": doc}


def test_upload_and_drafts(upload_result):
    doc = upload_result["doc"]
    drafts = doc["drafts"]
    for d in drafts:
        for k in ["page_start", "page_end", "part_name", "item_code", "rows"]:
            assert k in d, f"missing draft key {k}"


def test_upload_pages_pdf(admin_h, upload_result):
    uid = upload_result["upload_id"]
    r = requests.get(f"{API}/pdi/uploads/{uid}/pages.pdf",
                     params={"page_start": 1, "page_end": 1}, headers=admin_h, timeout=15)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_preview_draft(admin_h, upload_result):
    uid = upload_result["upload_id"]
    d = upload_result["doc"]["drafts"][0]
    payload = {"upload_id": uid, "page_start": d["page_start"], "page_end": d["page_end"],
               "rows": d.get("rows", [])}
    r = requests.post(f"{API}/pdi/templates/preview-draft", json=payload, headers=admin_h, timeout=30)
    assert r.status_code == 200, r.text
    assert r.content[:4] == b"%PDF"


# ---------------- Template create / revisions / delete ----------------

@pytest.fixture(scope="module")
def created_template(admin_h, upload_result):
    uid = upload_result["upload_id"]
    d = upload_result["doc"]["drafts"][0]
    payload = {
        "upload_id": uid, "page_start": d["page_start"], "page_end": d["page_end"],
        "part_name": f"TEST_TPL_{int(time.time())}",
        "item_code": f"TEST_IC_{int(time.time())}",
        "drg_no": "", "rows": d.get("rows", []),
        "mapped_parts": ["TEST_MP_A"], "customer": "TEST_CUST", "plant": "",
        "effective_from": "", "effective_to": "", "status": "active",
    }
    r = requests.post(f"{API}/pdi/templates", json=payload, headers=admin_h, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["revision"] == 1
    assert j["pages"] == (d["page_end"] - d["page_start"] + 1)
    yield j
    # cleanup
    requests.delete(f"{API}/pdi/templates/{j['id']}", headers=admin_h, timeout=15)


def test_create_template_and_revision1(created_template):
    assert created_template["revision"] == 1
    assert created_template["status"] == "active"
    assert "TEST_MP_A" in created_template.get("mapped_parts", [])


def test_update_bumps_revision_and_snapshot(admin_h, created_template):
    tid = created_template["id"]
    rows = list(created_template["rows"])
    if rows and isinstance(rows[0], dict) and "nominal" in rows[0]:
        rows[0] = {**rows[0], "nominal": (rows[0].get("nominal") or 10) + 1}
    r = requests.put(f"{API}/pdi/templates/{tid}",
                     json={"rows": rows, "part_name": created_template["part_name"] + " v2"},
                     headers=admin_h, timeout=30)
    assert r.status_code == 200
    assert r.json()["revision"] == 2

    r2 = requests.get(f"{API}/pdi/templates/{tid}/revisions", headers=admin_h, timeout=15)
    assert r2.status_code == 200
    revs = r2.json()
    assert len(revs) >= 2
    assert revs[0]["revision"] > revs[-1]["revision"], "revisions should be newest-first"
    for rv in revs:
        assert "saved_by" in rv or "created_by" in rv


def test_inactive_template_not_matched(admin_h, created_template):
    tid = created_template["id"]
    # deactivate
    r = requests.put(f"{API}/pdi/templates/{tid}", json={"status": "inactive"}, headers=admin_h, timeout=15)
    assert r.status_code == 200
    # match by mapped_part TEST_MP_A must NOT return this template
    rm = requests.get(f"{API}/pdi/match", params={"identifier": "TEST_MP_A"}, headers=admin_h, timeout=15)
    assert rm.status_code == 200
    j = rm.json()
    if j.get("matched"):
        assert j["template"]["id"] != tid
    # reactivate for cleanup
    requests.put(f"{API}/pdi/templates/{tid}", json={"status": "active"}, headers=admin_h, timeout=15)


def test_mapped_parts_exact_match_dowel_alt(admin_h):
    r = requests.get(f"{API}/pdi/match", params={"identifier": "DOWEL-ALT"}, headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    if not j["matched"]:
        pytest.skip("DOWEL-ALT mapping not present in this library (data-dependent)")
    assert "DOWEL-ALT" in (j["template"].get("mapped_parts") or []) or \
           j["template"].get("item_code") == "1968889"


def test_delete_in_use_returns_409(admin_h):
    r = requests.get(f"{API}/pdi/templates",
                     params={"q": "1968889"}, headers=admin_h, timeout=15)
    tid = None
    for it in r.json().get("items", []):
        if it.get("item_code") == "1968889":
            tid = it["id"]
            break
    assert tid, "Dowel Pin template not found"
    rd = requests.delete(f"{API}/pdi/templates/{tid}", headers=admin_h, timeout=15)
    assert rd.status_code == 409, f"expected 409 got {rd.status_code}: {rd.text}"


# ---------------- Revision-safe regenerate ----------------

def test_revision_safe_regenerate(admin_h):
    # find Dowel Pin template
    r = requests.get(f"{API}/pdi/templates", params={"q": "1968889"}, headers=admin_h, timeout=15)
    tpl = next(t for t in r.json()["items"] if t.get("item_code") == "1968889")
    tid = tpl["id"]
    # snapshot original rev
    orig_rev = tpl["revision"]
    # generate a report from this template
    gpayload = {"template_id": tid, "part_identifier": "1968889",
                "lot_size": "500", "lot_no": "TEST_REV_1",
                "inspector": "Ramesh Kumar", "approver": "S. Grewal"}
    g = requests.post(f"{API}/pdi/generate", json=gpayload, headers=admin_h, timeout=60)
    assert g.status_code == 200, g.text
    report = g.json()
    assert report["template_revision"] == orig_rev
    rid = report["id"]

    # Edit template: bump nominal on row 0
    rows = list(tpl["rows"])
    old_nom = rows[0].get("nominal")
    rows[0] = {**rows[0], "nominal": (old_nom or 10) + 0.5}
    up = requests.put(f"{API}/pdi/templates/{tid}", json={"rows": rows}, headers=admin_h, timeout=30)
    assert up.status_code == 200
    new_rev = up.json()["revision"]
    assert new_rev == orig_rev + 1

    # regenerate uses old revision snapshot
    rg = requests.post(f"{API}/pdi/reports/{rid}/regenerate", headers=admin_h, timeout=60)
    assert rg.status_code == 200, rg.text

    # Confirm report's template_revision unchanged
    rl = requests.get(f"{API}/pdi/reports", params={"q": "TEST_REV_1"}, headers=admin_h, timeout=15)
    r_items = rl.json()["items"]
    r_item = next(it for it in r_items if it["id"] == rid)
    assert r_item["template_revision"] == orig_rev, "regenerate must not bump report revision"

    # Cleanup: revert template edit (bumps rev again to orig_rev+2) and delete report
    rows[0] = {**rows[0], "nominal": old_nom}
    requests.put(f"{API}/pdi/templates/{tid}", json={"rows": rows}, headers=admin_h, timeout=30)
    requests.delete(f"{API}/pdi/reports/{rid}", headers=admin_h, timeout=15)


# ---------------- Dispatch options with lots ----------------

def test_dispatch_options_with_lots(admin_h):
    invoice = "26-27/1032"
    slip_body = {"invoice_number": invoice, "item_name": "TEST", "item_code": "TEST",
                 "total_quantity": 100, "single_packet_qty": 10, "boxes": 10,
                 "inside_cards": 0, "lot_number": "TESTLOT-A", "pdi_number": "",
                 "customer_name": "TEST", "customer_address": ""}
    r1 = requests.post(f"{API}/packing/slips", json=slip_body, headers=admin_h, timeout=15)
    assert r1.status_code == 200, r1.text
    id_a = r1.json()["id"]
    slip_body["lot_number"] = "TESTLOT-B"
    r2 = requests.post(f"{API}/packing/slips", json=slip_body, headers=admin_h, timeout=15)
    assert r2.status_code == 200
    id_b = r2.json()["id"]
    try:
        r = requests.get(f"{API}/pdi/dispatch-options", params={"q": invoice}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        arr = r.json()
        target = next((x for x in arr if x["invoice_number"] == invoice), None)
        assert target is not None, f"invoice {invoice} not in options"
        assert target["total_quantity"] > 0
        assert "TESTLOT-A" in target["lot_numbers"]
        assert "TESTLOT-B" in target["lot_numbers"]
    finally:
        requests.delete(f"{API}/packing/slips/{id_a}", headers=admin_h, timeout=15)
        requests.delete(f"{API}/packing/slips/{id_b}", headers=admin_h, timeout=15)


# ---------------- Masters manage ----------------

@pytest.mark.parametrize("kind", ["inspectors", "approvers"])
def test_masters_manage_flow(admin_h, dispatch_h, kind):
    # non-admin gets 403 on manage & PUT
    r_forbid = requests.get(f"{API}/pdi/masters/{kind}/manage", headers=dispatch_h, timeout=15)
    assert r_forbid.status_code == 403

    name = f"TEST_{kind.upper()}_M1"
    # create
    rc = requests.post(f"{API}/pdi/masters/{kind}", json={"name": name}, headers=admin_h, timeout=15)
    assert rc.status_code == 200

    # fetch manage list, find item id
    rm = requests.get(f"{API}/pdi/masters/{kind}/manage", headers=admin_h, timeout=15)
    assert rm.status_code == 200
    items = rm.json()
    row = next((x for x in items if x["name"] == name), None)
    assert row is not None and row["active"] is True
    item_id = row["id"]

    # rename
    new_name = name + "_R"
    r_rn = requests.put(f"{API}/pdi/masters/{kind}/{item_id}", json={"name": new_name}, headers=admin_h, timeout=15)
    assert r_rn.status_code == 200
    # non-admin PUT forbidden
    r_np = requests.put(f"{API}/pdi/masters/{kind}/{item_id}", json={"name": new_name}, headers=dispatch_h, timeout=15)
    assert r_np.status_code == 403

    # deactivate
    r_da = requests.put(f"{API}/pdi/masters/{kind}/{item_id}", json={"active": False}, headers=admin_h, timeout=15)
    assert r_da.status_code == 200
    active_list = requests.get(f"{API}/pdi/masters/{kind}", headers=admin_h, timeout=15).json()
    assert new_name not in active_list

    # reactivate
    r_ac = requests.put(f"{API}/pdi/masters/{kind}/{item_id}", json={"active": True}, headers=admin_h, timeout=15)
    assert r_ac.status_code == 200
    active_list2 = requests.get(f"{API}/pdi/masters/{kind}", headers=admin_h, timeout=15).json()
    assert new_name in active_list2

    # cleanup
    requests.delete(f"{API}/pdi/masters/{kind}/{item_id}", headers=admin_h, timeout=15)


# ---------------- Generate overrides + reports fields ----------------

def test_generate_overrides_and_report_fields(admin_h):
    payload = {"part_identifier": "1968889", "part_name": "OVR_NAME",
               "item_code": "OVR_IC", "lot_size": "250", "lot_no": "TEST_OVR",
               "inspector": "Ramesh Kumar", "approver": "S. Grewal"}
    r = requests.post(f"{API}/pdi/generate", json=payload, headers=admin_h, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["part_name"] == "OVR_NAME"
    assert j["item_code"] == "OVR_IC"
    assert isinstance(j["template_revision"], int) and j["template_revision"] >= 1
    rid = j["id"]

    # Reports list includes new fields
    rl = requests.get(f"{API}/pdi/reports", params={"q": "TEST_OVR"}, headers=admin_h, timeout=15)
    assert rl.status_code == 200
    items = rl.json()["items"]
    it = next(x for x in items if x["id"] == rid)
    for k in ("inspector", "approver", "template_revision", "created_by"):
        assert k in it
    assert it["inspector"] == "Ramesh Kumar"
    assert it["approver"] == "S. Grewal"
    assert it["created_by"] == "admin"

    # cleanup
    requests.delete(f"{API}/pdi/reports/{rid}", headers=admin_h, timeout=15)
