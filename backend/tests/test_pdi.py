"""Backend tests for PDI (AI PDI Generator) module."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def dispatch_token():
    r = requests.post(f"{API}/auth/login", json={"username": "dispatch", "password": "5@Grewal"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def dispatch_h(dispatch_token):
    return {"Authorization": f"Bearer {dispatch_token}"}


def test_import_status(admin_h):
    r = requests.get(f"{API}/pdi/import-status", headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("templates_in_library", 0) >= 120, f"expected >=120 got {j}"
    assert j.get("running") in (False, None)


def test_templates_search_guide(admin_h):
    r = requests.get(f"{API}/pdi/templates", params={"q": "GUIDE"}, headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["total"] >= 1, "expected at least 1 GUIDE template"
    it = j["items"][0]
    assert "rows" in it
    if it["rows"]:
        row = it["rows"][0]
        for k in ["sr", "specified_dimension", "method", "freq", "nominal", "tol_low", "tol_high", "value_type"]:
            assert k in row, f"missing key {k} in row"


def test_template_update_admin_and_forbidden_for_dispatch(admin_h, dispatch_h):
    r = requests.get(f"{API}/pdi/templates", params={"q": "GUIDE"}, headers=admin_h, timeout=15)
    tpl = r.json()["items"][0]
    tid = tpl["id"]
    orig_name = tpl.get("part_name", "")
    # non-admin gets 403
    r2 = requests.put(f"{API}/pdi/templates/{tid}", json={"part_name": orig_name + " X"}, headers=dispatch_h, timeout=15)
    assert r2.status_code == 403, f"expected 403 got {r2.status_code}"
    # admin update
    new_name = orig_name + " (edited)"
    r3 = requests.put(f"{API}/pdi/templates/{tid}", json={"part_name": new_name}, headers=admin_h, timeout=15)
    assert r3.status_code == 200
    assert r3.json()["part_name"] == new_name
    # revert
    requests.put(f"{API}/pdi/templates/{tid}", json={"part_name": orig_name}, headers=admin_h, timeout=15)


def test_template_source_pdf(admin_h):
    r = requests.get(f"{API}/pdi/templates", params={"q": "GUIDE"}, headers=admin_h, timeout=15)
    tid = r.json()["items"][0]["id"]
    r2 = requests.get(f"{API}/pdi/templates/{tid}/source.pdf", headers=admin_h, timeout=20)
    assert r2.status_code == 200
    assert r2.headers.get("content-type", "").startswith("application/pdf")
    assert r2.content[:4] == b"%PDF"


def test_match_1968889(admin_h):
    r = requests.get(f"{API}/pdi/match", params={"identifier": "1968889"}, headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["matched"] is True
    assert "Dowel" in (j["template"].get("part_name") or "") or j["template"].get("item_code") == "1968889"


def test_masters_inspectors_and_approvers(admin_h, dispatch_h):
    # list
    r = requests.get(f"{API}/pdi/masters/inspectors", headers=admin_h, timeout=15)
    assert r.status_code == 200
    inspectors = r.json()
    assert isinstance(inspectors, list) and len(inspectors) >= 1
    r = requests.get(f"{API}/pdi/masters/approvers", headers=admin_h, timeout=15)
    approvers = r.json()
    assert isinstance(approvers, list) and len(approvers) >= 1

    # POST forbidden for non-admin
    r2 = requests.post(f"{API}/pdi/masters/inspectors", json={"name": "TEST_INSP1"}, headers=dispatch_h, timeout=15)
    assert r2.status_code == 403

    # Admin add + delete
    r3 = requests.post(f"{API}/pdi/masters/inspectors", json={"name": "TEST_INSP1"}, headers=admin_h, timeout=15)
    assert r3.status_code == 200
    r4 = requests.get(f"{API}/pdi/masters/inspectors", headers=admin_h, timeout=15)
    assert "TEST_INSP1" in r4.json()
    r5 = requests.get(f"{API}/pdi/masters/inspectors/manage", headers=admin_h, timeout=15)
    insp_id = next(d["id"] for d in r5.json() if d["name"] == "TEST_INSP1")
    r5d = requests.delete(f"{API}/pdi/masters/inspectors/{insp_id}", headers=admin_h, timeout=15)
    assert r5d.status_code == 200

    r6 = requests.post(f"{API}/pdi/masters/approvers", json={"name": "TEST_APR1"}, headers=admin_h, timeout=15)
    assert r6.status_code == 200
    r7 = requests.get(f"{API}/pdi/masters/approvers/manage", headers=admin_h, timeout=15)
    apr_id = next(d["id"] for d in r7.json() if d["name"] == "TEST_APR1")
    r7d = requests.delete(f"{API}/pdi/masters/approvers/{apr_id}", headers=admin_h, timeout=15)
    assert r7d.status_code == 200


@pytest.fixture(scope="module")
def generated_report(admin_h):
    payload = {
        "part_identifier": "1968889",
        "lot_size": "500",
        "lot_no": "TEST_LOT_1",
        "inspector": "Ramesh Kumar",
        "approver": "S. Grewal",
    }
    r = requests.post(f"{API}/pdi/generate", json=payload, headers=admin_h, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def test_generate_report_and_observations(generated_report):
    j = generated_report
    assert j["report_no"].startswith("PDI-")
    assert j["item_code"] == "1968889" or "Dowel" in j.get("part_name", "")
    obs = j.get("observations", [])
    assert isinstance(obs, list) and len(obs) > 0
    # Check dimension rows have numeric values within tolerance
    # Need template rows to cross-check
    # fetch template
    tid = j["template_id"]


def test_reports_list_and_search(admin_h, generated_report):
    r = requests.get(f"{API}/pdi/reports", params={"q": "PDI-"}, headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["total"] >= 1
    # search by lot_no
    r2 = requests.get(f"{API}/pdi/reports", params={"q": "TEST_LOT_1"}, headers=admin_h, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["total"] >= 1
    # by item_code
    r3 = requests.get(f"{API}/pdi/reports", params={"q": "1968889"}, headers=admin_h, timeout=15)
    assert r3.json()["total"] >= 1


def test_report_pdf_inline_and_download(admin_h, generated_report):
    rid = generated_report["id"]
    r = requests.get(f"{API}/pdi/reports/{rid}/pdf", headers=admin_h, timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert "inline" in r.headers.get("content-disposition", "").lower()
    assert r.content[:4] == b"%PDF"
    r2 = requests.get(f"{API}/pdi/reports/{rid}/pdf", params={"download": 1}, headers=admin_h, timeout=30)
    assert r2.status_code == 200
    assert "attachment" in r2.headers.get("content-disposition", "").lower()


def test_regenerate(admin_h, generated_report):
    rid = generated_report["id"]
    orig_obs = generated_report.get("observations", [])
    r = requests.post(f"{API}/pdi/reports/{rid}/regenerate", headers=admin_h, timeout=60)
    assert r.status_code == 200
    assert r.json().get("status") == "regenerated"
    # fetch updated report list to see new obs
    r2 = requests.get(f"{API}/pdi/reports", params={"q": generated_report["report_no"]}, headers=admin_h, timeout=15)
    # Not directly comparing but confirm reports still lists
    assert r2.status_code == 200


def test_delete_report_admin_only(admin_h, dispatch_h):
    # create a throwaway
    payload = {"part_identifier": "1968889", "lot_size": "100", "lot_no": "TEST_LOT_DEL",
               "inspector": "Ramesh Kumar", "approver": "S. Grewal"}
    r = requests.post(f"{API}/pdi/generate", json=payload, headers=admin_h, timeout=60)
    rid = r.json()["id"]
    # non-admin
    r2 = requests.delete(f"{API}/pdi/reports/{rid}", headers=dispatch_h, timeout=15)
    assert r2.status_code == 403
    # admin
    r3 = requests.delete(f"{API}/pdi/reports/{rid}", headers=admin_h, timeout=15)
    assert r3.status_code == 200


def test_last_used(admin_h, generated_report):
    r = requests.get(f"{API}/pdi/last-used", headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("inspector") in ("Ramesh Kumar", "Sunil Verma")
    assert j.get("approver") == "S. Grewal"


def test_modules_has_pdi_no_dqms(admin_h):
    r = requests.get(f"{API}/modules", headers=admin_h, timeout=15)
    assert r.status_code == 200
    j = r.json()
    keys = [m.get("key") for m in j] if isinstance(j, list) else [m.get("key") for m in j.get("modules", [])]
    assert "dqms" not in keys
    assert "pdi" in keys
    if isinstance(j, list):
        pdi = next(m for m in j if m.get("key") == "pdi")
    else:
        pdi = next(m for m in j.get("modules", []) if m.get("key") == "pdi")
    assert pdi.get("status") == "active"


def test_observations_within_tolerance(admin_h, generated_report):
    """For each dimension row in observations, if numeric, verify within tolerance range."""
    obs = generated_report.get("observations", [])
    # Fetch template to know nominal/tol
    tid = generated_report["template_id"]
    r = requests.get(f"{API}/pdi/templates/{tid}", headers=admin_h, timeout=15)
    rows = r.json().get("rows", [])
    for row, ob in zip(rows, obs):
        if row.get("value_type") == "dimension":
            nominal = row.get("nominal")
            tl = row.get("tol_low")
            th = row.get("tol_high")
            val = ob.get("value") if isinstance(ob, dict) else None
            if nominal is not None and tl is not None and th is not None and isinstance(val, (int, float)):
                lo = nominal + tl
                hi = nominal + th
                assert lo <= val <= hi, f"row {row.get('sr')} value {val} not in [{lo},{hi}]"
