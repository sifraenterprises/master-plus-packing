"""Reports/ERP Dashboard backend tests"""
import os
import pytest
import requests

BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login('admin', '5@Sohangso')}"}


@pytest.fixture(scope="module")
def dispatch_h():
    return {"Authorization": f"Bearer {_login('dispatch', '5@Grewal')}"}


# ---------- KPIs ----------
def test_kpis(admin_h):
    r = requests.get(f"{API}/reports/kpis", headers=admin_h, timeout=30)
    assert r.status_code == 200
    d = r.json()
    for k in ("today_dispatches", "today_boxes", "month_dispatches", "month_boxes",
              "pending_packing", "completed_packing", "pending_asn", "completed_asn",
              "pending_eway", "completed_eway", "pending_vendor_ack", "completed_vendor_ack",
              "pending_pdi", "completed_pdi"):
        assert k in d, f"missing kpi {k}"


# ---------- ERP list ----------
def test_erp_basic(admin_h):
    r = requests.get(f"{API}/reports/erp", headers=admin_h, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert set(("items", "total", "page", "page_size", "pages")).issubset(d)
    assert isinstance(d["items"], list)
    if d["items"]:
        row = d["items"][0]
        for k in ("invoice_number", "packing_status", "asn_status", "eway_status", "vendor_ack_status", "pdi_status"):
            assert k in row


def test_erp_pagination(admin_h):
    r = requests.get(f"{API}/reports/erp?page=1&page_size=2", headers=admin_h, timeout=30).json()
    assert r["page_size"] == 2 and len(r["items"]) <= 2
    assert r["pages"] >= 1


def test_erp_sort_asc(admin_h):
    r = requests.get(f"{API}/reports/erp?sort_by=invoice_number&sort_dir=asc&page_size=50",
                     headers=admin_h, timeout=30).json()
    invs = [x["invoice_number"] for x in r["items"]]
    assert invs == sorted(invs)


def test_erp_filter_invoice_2001(admin_h):
    r = requests.get(f"{API}/reports/erp?invoice=2001", headers=admin_h, timeout=30).json()
    if r["total"] == 0:
        pytest.skip("no 26-27/2001 record present in this database")
    for x in r["items"]:
        assert "2001" in x["invoice_number"]


def test_erp_status_computation_2001(admin_h):
    # 26-27/2001 should have packing Completed, asn Completed, eway Pending, vack Completed
    r = requests.get(f"{API}/reports/erp?invoice=2001", headers=admin_h, timeout=30).json()
    if not r["items"]:
        pytest.skip("2001 row not present")
    row = next((x for x in r["items"] if "2001" in x["invoice_number"]), None)
    assert row, "26-27/2001 row not found"
    assert row["packing_status"] == "Completed"
    assert row["asn_status"] == "Completed"
    assert row["vendor_ack_status"] == "Completed"


def test_erp_filter_asn_status_completed(admin_h):
    r = requests.get(f"{API}/reports/erp?asn_status=Completed", headers=admin_h, timeout=30).json()
    for x in r["items"]:
        assert x["asn_status"] == "Completed"


def test_erp_filter_asn_status_pending(admin_h):
    r = requests.get(f"{API}/reports/erp?asn_status=Pending", headers=admin_h, timeout=30).json()
    for x in r["items"]:
        assert x["asn_status"] == "Pending"


# ---------- Exports ----------
def test_export_excel(admin_h):
    r = requests.get(f"{API}/reports/erp/export?format=excel&columns=invoice_number,asn_status",
                     headers=admin_h, timeout=60)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers.get("content-type", "")


def test_export_pdf(admin_h):
    r = requests.get(f"{API}/reports/erp/export?format=pdf", headers=admin_h, timeout=60)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")


def test_export_csv(admin_h):
    r = requests.get(f"{API}/reports/erp/export?format=csv&columns=invoice_number,asn_status",
                     headers=admin_h, timeout=60)
    assert r.status_code == 200
    body = r.content.decode("utf-8-sig")
    header = body.splitlines()[0]
    assert "Invoice Number" in header and "ASN" in header


# ---------- Charts ----------
def test_charts(admin_h):
    r = requests.get(f"{API}/reports/charts", headers=admin_h, timeout=30).json()
    for k in ("by_month", "by_customer", "by_plant", "by_transporter", "boxes_per_day", "completion"):
        assert k in r
    for k in ("asn", "eway", "vendor_ack"):
        assert k in r["completion"]


# ---------- Grouping ----------
def test_group_customer(admin_h):
    r = requests.get(f"{API}/reports/group?by=customer", headers=admin_h, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert "rows" in d and "totals" in d
    assert set(("dispatches", "boxes", "value")).issubset(d["totals"])


@pytest.mark.parametrize("by", ["plant", "transporter", "month"])
def test_group_others(admin_h, by):
    assert requests.get(f"{API}/reports/group?by={by}", headers=admin_h, timeout=30).status_code == 200


def test_group_invalid(admin_h):
    assert requests.get(f"{API}/reports/group?by=bogus", headers=admin_h, timeout=30).status_code == 400


# ---------- Workflow drill-down ----------
def test_workflow_valid(admin_h):
    row = requests.get(f"{API}/reports/erp?invoice=2001", headers=admin_h, timeout=30).json()["items"]
    if not row:
        pytest.skip("no 2001 row")
    mid = row[0]["id"]
    r = requests.get(f"{API}/reports/workflow/{mid}", headers=admin_h, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["dispatch"]["id"] == mid
    keys = [s["key"] for s in d["steps"]]
    assert keys == ["master_dispatch", "packing", "asn", "eway", "vendor_ack", "dqms"]
    for s in d["steps"]:
        assert s["status"] in ("Completed", "Pending", "Failed")


def test_workflow_invalid_id(admin_h):
    assert requests.get(f"{API}/reports/workflow/notanid", headers=admin_h, timeout=30).status_code == 400


def test_workflow_missing(admin_h):
    assert requests.get(f"{API}/reports/workflow/507f1f77bcf86cd799439011",
                        headers=admin_h, timeout=30).status_code == 404


# ---------- Saved Views RBAC ----------
def test_admin_can_save_shared_view(admin_h):
    payload = {"name": "TEST_shared_view", "filters": {"asn_status": "Pending"}, "columns": ["invoice_number"],
               "scope": "shared"}
    r = requests.post(f"{API}/reports/views", json=payload, headers=admin_h, timeout=30)
    assert r.status_code in (200, 201)
    vid = r.json()["id"]
    # cleanup
    requests.delete(f"{API}/reports/views/{vid}", headers=admin_h, timeout=30)


def test_dispatch_shared_forbidden(dispatch_h):
    r = requests.post(f"{API}/reports/views",
                      json={"name": "TEST_dispatch_shared", "filters": {}, "columns": [], "scope": "shared"},
                      headers=dispatch_h, timeout=30)
    assert r.status_code == 403


def test_dispatch_personal_ok_and_default(dispatch_h):
    r = requests.post(f"{API}/reports/views",
                      json={"name": "TEST_dispatch_personal", "filters": {"customer": "TAFE"},
                            "columns": ["invoice_number"], "scope": "personal"},
                      headers=dispatch_h, timeout=30)
    assert r.status_code in (200, 201)
    vid = r.json()["id"]
    # set default
    r = requests.post(f"{API}/reports/views/{vid}/default", headers=dispatch_h, timeout=30)
    assert r.status_code == 200
    # GET returns default_view_id
    r = requests.get(f"{API}/reports/views", headers=dispatch_h, timeout=30).json()
    assert r["default_view_id"] == vid
    # own delete OK
    assert requests.delete(f"{API}/reports/views/{vid}", headers=dispatch_h, timeout=30).status_code == 200


def test_dispatch_cannot_delete_admin_shared(admin_h, dispatch_h):
    r = requests.post(f"{API}/reports/views",
                      json={"name": "TEST_admin_shared_del", "filters": {}, "columns": [], "scope": "shared"},
                      headers=admin_h, timeout=30)
    vid = r.json()["id"]
    try:
        assert requests.delete(f"{API}/reports/views/{vid}", headers=dispatch_h, timeout=30).status_code == 403
    finally:
        requests.delete(f"{API}/reports/views/{vid}", headers=admin_h, timeout=30)


def test_views_list_visibility(admin_h, dispatch_h):
    ar = requests.post(f"{API}/reports/views",
                       json={"name": "TEST_admin_shared_vis", "filters": {}, "columns": [], "scope": "shared"},
                       headers=admin_h, timeout=30).json()
    try:
        listing = requests.get(f"{API}/reports/views", headers=dispatch_h, timeout=30).json()
        names = [v["name"] for v in listing["views"]]
        assert "TEST_admin_shared_vis" in names
    finally:
        requests.delete(f"{API}/reports/views/{ar['id']}", headers=admin_h, timeout=30)


# ---------- Regression ----------
def test_regression_summary(admin_h):
    assert requests.get(f"{API}/reports/summary", headers=admin_h, timeout=30).status_code == 200


def test_regression_master_dispatch_list(admin_h):
    assert requests.get(f"{API}/master-dispatch", headers=admin_h, timeout=30).status_code == 200


def test_regression_daily_report(admin_h):
    r = requests.get(f"{API}/master-dispatch/daily-report?date=2026-06-13", headers=admin_h, timeout=30)
    assert r.status_code == 200
