"""Backend tests for the Master Dispatch module."""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://invoice-master-295.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "admin", "password": "5@Sohangso"}
DISPATCH = {"username": "dispatch", "password": "5@Grewal"}
SAMPLE_PDF = "/tmp/sample_invoice.pdf"


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def dispatch_token():
    r = requests.post(f"{API}/auth/login", json=DISPATCH, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ---------- Auth / basics ----------
class TestAuthBasics:
    def test_admin_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_dispatch_me(self, dispatch_token):
        r = requests.get(f"{API}/auth/me", headers=_auth(dispatch_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["role"] == "dispatch"


# ---------- Stats ----------
class TestStats:
    def test_stats_requires_auth(self):
        r = requests.get(f"{API}/master-dispatch/stats", timeout=10)
        assert r.status_code == 401

    def test_stats_shape(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/stats", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        data = r.json()
        for k in ["total", "today", "pending", "ready_for_asn",
                  "ready_for_eway", "completed", "ocr_errors", "needs_review"]:
            assert k in data, f"missing key {k}"
            assert isinstance(data[k], int)


# ---------- Upload / OCR ----------
class TestUpload:
    _batch_id = None
    _record_id = None
    _source_file_id = None

    def test_reject_non_pdf(self, admin_token):
        files = {"files": ("bad.txt", b"hello world", "text/plain")}
        r = requests.post(f"{API}/master-dispatch/upload", files=files, headers=_auth(admin_token), timeout=15)
        assert r.status_code == 400

    def test_upload_sample_pdf(self, admin_token):
        assert os.path.exists(SAMPLE_PDF), f"missing {SAMPLE_PDF}"
        with open(SAMPLE_PDF, "rb") as fh:
            files = {"files": ("sample_invoice.pdf", fh.read(), "application/pdf")}
        r = requests.post(f"{API}/master-dispatch/upload", files=files, headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "batch_id" in body
        assert body["status"] == "processing"
        TestUpload._batch_id = body["batch_id"]

    def test_batch_completes_and_creates_record(self, admin_token):
        assert TestUpload._batch_id
        deadline = time.time() + 90
        last = None
        while time.time() < deadline:
            r = requests.get(f"{API}/master-dispatch/batches/{TestUpload._batch_id}",
                             headers=_auth(admin_token), timeout=15)
            assert r.status_code == 200
            last = r.json()
            if last.get("status") in ("completed", "failed", "partial"):
                break
            time.sleep(3)
        assert last, "no batch response"
        # accept completed/partial as terminal; error only if still processing
        assert last["status"] != "processing", f"batch stuck: {last}"
        # Pull records from batch
        rl = requests.get(f"{API}/master-dispatch?batch_id={TestUpload._batch_id}",
                          headers=_auth(admin_token), timeout=15)
        assert rl.status_code == 200
        items = rl.json()["items"]
        assert len(items) >= 1, f"no records created from batch (batch={last})"
        rec = items[0]
        assert rec["dispatch_no"].startswith("GEW-MD-")
        assert rec["verified"] is False
        # Ideally extraction worked; log for debug but be lenient
        TestUpload._record_id = rec["id"]
        TestUpload._source_file_id = rec.get("source_file_id") or rec.get("split_file_id")

    def test_get_stored_file(self, admin_token):
        if not TestUpload._source_file_id:
            pytest.skip("no source_file_id from OCR")
        r = requests.get(f"{API}/master-dispatch/files/{TestUpload._source_file_id}",
                         headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        assert "pdf" in r.headers.get("content-type", "")
        assert r.content.startswith(b"%PDF")

    def test_batches_pagination(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/batches?page=1&page_size=10",
                         headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ["items", "total", "page", "pages"]:
            assert k in body
        assert body["total"] >= 1


# ---------- CRUD ----------
class TestCRUD:
    _id = None
    _dup_id = None
    _dispatch_no = None

    def test_manual_create(self, admin_token):
        payload = {
            "customer_name": "TEST_MD_Customer",
            "gstin": "27ABCDE1234F1Z5",
            "invoice_number": "TEST-MD-INV-001",
            "invoice_date": "2026-01-10",
            "items": [{"part_number": "P-1", "description": "d", "quantity": 2, "rate": 50, "amount": 100}],
            "invoice_total": 100.0,
            "status": "pending",
        }
        r = requests.post(f"{API}/master-dispatch", json=payload, headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dispatch_no"].startswith("GEW-MD-")
        assert d["customer_name"] == "TEST_MD_Customer"
        TestCRUD._id = d["id"]
        TestCRUD._dispatch_no = d["dispatch_no"]

    def test_get_by_id(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/{TestCRUD._id}", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["invoice_number"] == "TEST-MD-INV-001"

    def test_update_verifies(self, admin_token):
        payload = {
            "customer_name": "TEST_MD_Customer_UPD",
            "gstin": "27ABCDE1234F1Z5",
            "invoice_number": "TEST-MD-INV-001",
            "invoice_date": "2026-01-10",
            "items": [{"part_number": "P-1", "description": "d", "quantity": 2, "rate": 50, "amount": 100}],
            "invoice_total": 100.0,
            "status": "ready_for_asn",
            "verified": True,
        }
        r = requests.put(f"{API}/master-dispatch/{TestCRUD._id}",
                         json=payload, headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["verified"] is True
        assert d["customer_name"] == "TEST_MD_Customer_UPD"
        assert d["status"] == "ready_for_asn"

    def test_list_with_filters_and_sort(self, admin_token):
        r = requests.get(
            f"{API}/master-dispatch?search=TEST-MD-INV-001&status=ready_for_asn"
            f"&sort_by=invoice_total&sort_dir=asc&page=1&page_size=25",
            headers=_auth(admin_token), timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        for k in ["items", "total", "page", "page_size", "pages"]:
            assert k in body
        assert any(x["id"] == TestCRUD._id for x in body["items"])

    def test_list_date_filter(self, admin_token):
        r = requests.get(
            f"{API}/master-dispatch?date_from=2026-01-01&date_to=2026-12-31",
            headers=_auth(admin_token), timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_duplicate(self, admin_token):
        r = requests.post(f"{API}/master-dispatch/{TestCRUD._id}/duplicate",
                          headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dispatch_no"] != TestCRUD._dispatch_no
        assert d["dispatch_no"].startswith("GEW-MD-")
        TestCRUD._dup_id = d["id"]

    def test_delete_forbidden_for_dispatch(self, dispatch_token):
        r = requests.delete(f"{API}/master-dispatch/{TestCRUD._id}",
                            headers=_auth(dispatch_token), timeout=10)
        assert r.status_code == 403

    def test_delete_admin(self, admin_token):
        r1 = requests.delete(f"{API}/master-dispatch/{TestCRUD._id}",
                             headers=_auth(admin_token), timeout=10)
        assert r1.status_code == 200
        r2 = requests.delete(f"{API}/master-dispatch/{TestCRUD._dup_id}",
                             headers=_auth(admin_token), timeout=10)
        assert r2.status_code == 200
        # verify gone
        r3 = requests.get(f"{API}/master-dispatch/{TestCRUD._id}",
                          headers=_auth(admin_token), timeout=10)
        assert r3.status_code == 404


# ---------- Exports ----------
class TestExports:
    def test_export_excel(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/export/excel",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 200

    def test_export_pdf(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/export/pdf",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        assert "pdf" in r.headers.get("content-type", "")
        assert r.content.startswith(b"%PDF")


# ---------- Regression ----------
class TestRegression:
    def test_dispatch_list(self, admin_token):
        r = requests.get(f"{API}/dispatch", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_modules(self, admin_token):
        r = requests.get(f"{API}/modules", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) > 0

    def test_reports_summary(self, admin_token):
        r = requests.get(f"{API}/reports/summary", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        for k in ["total_dispatches", "this_month", "unique_customers", "total_value"]:
            assert k in r.json()

    def test_packing_slips(self, admin_token):
        r = requests.get(f"{API}/packing/slips", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
