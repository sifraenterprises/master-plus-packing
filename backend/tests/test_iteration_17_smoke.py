"""Production readiness smoke regression - iteration 17.
Covers backend items listed in review_request.
"""
import os
import requests
import pytest

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return "http://localhost:8001"

BASE_URL = _load_url()
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def dispatch_token():
    r = requests.post(f"{API}/auth/login", json={"username": "dispatch", "password": "5@Grewal"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def ah(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def dh(dispatch_token):
    return {"Authorization": f"Bearer {dispatch_token}"}


# ---------- Auth ----------

def test_health_ok():
    r = requests.get("http://localhost:8001/health", timeout=10)
    assert r.status_code == 200 and r.json().get("status") == "ok"


def test_login_admin():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"}, timeout=15)
    assert r.status_code == 200
    assert "token" in r.json()


def test_login_dispatch():
    r = requests.post(f"{API}/auth/login", json={"username": "dispatch", "password": "5@Grewal"}, timeout=15)
    assert r.status_code == 200
    assert "token" in r.json()


def test_protected_no_token_returns_401():
    r = requests.get(f"{API}/master-dispatch/stats", timeout=10)
    assert r.status_code in (401, 403)


def test_admin_only_forbidden_for_dispatch(dh):
    r = requests.get(f"{API}/system/status", headers=dh, timeout=10)
    assert r.status_code == 403


# ---------- Module smoke ----------

def test_modules(ah):
    r = requests.get(f"{API}/modules", headers=ah, timeout=10)
    assert r.status_code == 200
    data = r.json()
    keys = {m.get("key") if isinstance(m, dict) else None for m in data} if isinstance(data, list) else set(data.keys())
    # pdi active, dqms not present
    assert any("pdi" in str(k).lower() for k in keys), f"no pdi in modules: {keys}"
    assert not any("dqms" in str(k).lower() for k in keys), f"dqms still present: {keys}"


def test_master_dispatch_has_pdi_field(ah):
    r = requests.get(f"{API}/master-dispatch?page=1&page_size=5", headers=ah, timeout=15)
    assert r.status_code == 200
    body = r.json()
    records = body if isinstance(body, list) else body.get("records") or body.get("items") or body.get("data") or []
    assert records, f"no records returned: {body}"
    # PDI field should exist on record (may be null)
    assert any("pdi" in k.lower() for k in records[0].keys()), f"no pdi field in record keys: {list(records[0].keys())}"


def test_pdi_templates(ah):
    r = requests.get(f"{API}/pdi/templates", headers=ah, timeout=15)
    assert r.status_code == 200
    body = r.json()
    total = body.get("total") if isinstance(body, dict) else None
    tpl = body.get("items") if isinstance(body, dict) else body
    assert (total or len(tpl)) >= 100, f"expected ~120 templates, got total={total} items={len(tpl)}"


def test_pdi_reports(ah):
    r = requests.get(f"{API}/pdi/reports", headers=ah, timeout=15)
    assert r.status_code == 200
    body = r.json()
    reports = body if isinstance(body, list) else body.get("reports") or body.get("items") or []
    if reports:
        assert "sample_count" in reports[0] or any("sample" in k for k in reports[0].keys())


def test_pdi_inspectors(ah):
    r = requests.get(f"{API}/pdi/masters/inspectors", headers=ah, timeout=15)
    assert r.status_code == 200


def test_documents_types(ah):
    r = requests.get(f"{API}/documents/types", headers=ah, timeout=15)
    assert r.status_code == 200
    body = r.json()
    types = body if isinstance(body, list) else body.get("types") or []
    assert len(types) >= 7, f"expected 7+ types, got {len(types)}"
    pdi = [t for t in types if "pdi" in str(t.get("key", "")).lower() or "pdi" in str(t.get("label", "")).lower()]
    assert pdi, "no pdi document type"
    assert pdi[0].get("required_for_asn") is True, f"pdi required_for_asn not true: {pdi[0]}"


def test_asn_records(ah):
    r = requests.get(f"{API}/asn/records?page=1&page_size=5", headers=ah, timeout=15)
    assert r.status_code == 200


def test_reports_kpis_has_pdi(ah):
    r = requests.get(f"{API}/reports/kpis", headers=ah, timeout=15)
    assert r.status_code == 200
    j = r.json()
    flat = str(j).lower()
    assert "pdi" in flat, f"no pdi counter in kpis: {j}"


def test_system_health(ah):
    r = requests.get(f"{API}/system/health", headers=ah, timeout=15)
    # some builds only expose /system/status; accept 200 or 404 with fallback
    if r.status_code == 404:
        r = requests.get(f"{API}/system/status", headers=ah, timeout=15)
    assert r.status_code == 200


# ---------- PDI E2E ----------

def test_pdi_generate_e2e(ah):
    payload = {"part_identifier": "1968889", "sample_count": 5}
    r = requests.post(f"{API}/pdi/generate", json=payload, headers=ah, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    report_no = body.get("report_no")
    report_id = body.get("id") or body.get("report_id")
    assert report_no, f"no report_no: {body}"
    assert report_id
    # observations: list of lists, each with 5 samples
    obs = body.get("observations") or []
    assert obs, "no observations"
    for row in obs:
        if isinstance(row, list):
            assert len(row) == 5, f"row has {len(row)} samples: {row}"
        elif isinstance(row, dict):
            vals = row.get("values") or row.get("samples") or []
            if vals:
                assert len(vals) == 5
    # PDF
    r3 = requests.get(f"{API}/pdi/reports/{report_id}/pdf", headers=ah, timeout=30)
    assert r3.status_code == 200
    assert "application/pdf" in r3.headers.get("Content-Type", "").lower()
    # Cleanup
    rd = requests.delete(f"{API}/pdi/reports/{report_id}", headers=ah, timeout=15)
    assert rd.status_code in (200, 204)


def test_pdi_template_source_pdf(ah):
    r = requests.get(f"{API}/pdi/templates", headers=ah, timeout=15)
    assert r.status_code == 200
    body = r.json()
    tpl = body.get("items") if isinstance(body, dict) else body
    assert tpl
    tid = tpl[0].get("id") or tpl[0].get("_id")
    r2 = requests.get(f"{API}/pdi/templates/{tid}/source.pdf", headers=ah, timeout=30)
    assert r2.status_code == 200
    assert "application/pdf" in r2.headers.get("Content-Type", "").lower()
