"""ASN Creation module end-to-end tests (TEST/simulation mode)."""
import os
import time
import io
import pytest
import requests

BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
API = f"{BASE_URL}/api"
PDI_PATH = "/tmp/pdi_test.pdf"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def H(token):
    return {"Authorization": f"Bearer {token}"}


def wait_run_idle(H, timeout=180):
    """Waits until no ASN run is active (other test modules may share the single-run lock)."""
    start = time.time()
    while time.time() - start < timeout:
        rs = requests.get(f"{API}/asn/run-status", headers=H).json()
        if not rs.get("running"):
            return
        pw = rs.get("awaiting_pdi")
        if pw:
            requests.post(f"{API}/asn/pdi-wait/confirm", headers=H, json={"record_id": pw["record_id"]})
        time.sleep(1)
    raise AssertionError("another run never finished")


def wait_run_done(H, timeout=60):
    start = time.time()
    while time.time() - start < timeout:
        rs = requests.get(f"{API}/asn/run-status", headers=H).json()
        if not rs.get("running"):
            return rs
        time.sleep(1)
    raise AssertionError("Run did not finish in time")


def wait_awaiting_pdi(H, timeout=30):
    """Polls until the worker pauses at the PDI attachment stage."""
    start = time.time()
    while time.time() - start < timeout:
        rs = requests.get(f"{API}/asn/run-status", headers=H).json()
        if rs.get("awaiting_pdi"):
            return rs
        if not rs.get("running"):
            raise AssertionError(f"run finished before awaiting_pdi appeared: {rs}")
        time.sleep(0.5)
    raise AssertionError("awaiting_pdi was never set")


def confirm_pdi(H, record_id):
    r = requests.post(f"{API}/asn/pdi-wait/confirm", headers=H, json={"record_id": record_id})
    assert r.status_code == 200, r.text


def seed_md(H, invoice_no, po=""):
    """Seed a master_dispatch record via the internal seed endpoint if available, else use OCR create route."""
    # We'll POST directly to a helper - use manual insertion via master-dispatch create endpoint
    body = {
        "dispatch_no": f"D{invoice_no}",
        "invoice_number": invoice_no,
        "invoice_date": "2026-01-15",
        "po_number": po,
        "asn_number": "",
        "plant": "M04",
        "vehicle_number": "PB10AB1234",
        "transporter_name": "V.R.L. LOGISTICS LIMITED",
        "invoice_total": 118000,
        "gst_total": 18000,
        "cgst": 9000,
        "sgst": 9000,
        "igst": 0,
        "boxes": 2,
        "items": [{"part_number": "P123", "description": "Widget", "quantity": 10}],
    }
    r = requests.post(f"{API}/master-dispatch", headers=H, json=body)
    assert r.status_code in (200, 201), f"seed md failed: {r.status_code} {r.text}"
    return r.json()


class TestASNFlow:
    def test_01_stats_and_records(self, H):
        r = requests.get(f"{API}/asn/stats", headers=H)
        assert r.status_code == 200
        for k in ("total", "ready", "draft", "processing", "completed", "failed", "today"):
            assert k in r.json()

        r = requests.get(f"{API}/asn/records", headers=H)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_02_import_idempotent(self, H):
        # seed a fresh MD record with no asn_number
        seed_md(H, f"TEST/9101-{int(time.time())}")
        r = requests.post(f"{API}/asn/import", headers=H)
        assert r.status_code == 200
        first = r.json()["imported"]
        assert first >= 1, f"expected imported>=1, got {first}"
        # re-import should be idempotent
        r2 = requests.post(f"{API}/asn/import", headers=H)
        assert r2.status_code == 200
        assert r2.json()["imported"] == 0

    def test_03_happy_path_edit_run_with_pdi_pause(self, H):
        inv = f"TEST/9200-{int(time.time())}"
        md = seed_md(H, inv)
        md_id = md.get("id") or md.get("_id")
        requests.post(f"{API}/asn/import", headers=H)
        # find the asn record
        recs = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"]
        assert recs, "imported asn record not found"
        rec = recs[0]
        assert rec["status"] == "Draft", f"expected Draft, got {rec['status']}"
        rid = rec["id"]

        # Edit PO + transporter — record becomes Ready WITHOUT any PDI
        r = requests.put(f"{API}/asn/records/{rid}", headers=H, json={
            "po_number": "5540011947", "transporter": "V.R.L. LOGISTICS LIMITED",
            "basic_amount": 100000, "total_amount": 118000,
        })
        assert r.status_code == 200, r.text
        assert r.json()["po_number"] == "5540011947"
        assert r.json()["status"] == "Ready", "Ready must not require a PDI anymore"

        # PO synced to MD
        md_check = requests.get(f"{API}/master-dispatch/{md_id}", headers=H)
        if md_check.status_code == 200:
            assert md_check.json().get("po_number") == "5540011947"

        # Run — worker must pause at the PDI attachment stage
        wait_run_idle(H)
        r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        if r.status_code == 409:
            wait_run_idle(H)
            r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        assert r.status_code == 200, r.text
        rs = wait_awaiting_pdi(H)
        aw = rs["awaiting_pdi"]
        assert aw["record_id"] == rid
        assert aw["invoice_no"] == inv
        assert aw.get("timeout_seconds")
        assert rs.get("phase") == "Waiting for manual PDI upload"
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        assert rec["status"] == "Waiting for PDI Upload", rec["status"]
        assert rec["asn_number"] == "", "ASN must NOT be created while waiting for PDI"

        # User uploads PDI on the portal, then resumes
        confirm_pdi(H, rid)
        rs = wait_run_done(H)
        assert rs["processed"] == 1

        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        assert rec["status"] == "Completed", f"expected Completed, got {rec['status']} err={rec.get('error_message')}"
        assert rec["asn_number"].startswith("ASN"), rec["asn_number"]
        events = {e["event"] for e in rec.get("automation_log", [])}
        for ev in ("Run Started", "PO Selected", "Parts Added", "Invoice Filled",
                   "Transporter Selected", "PDI Section", "PDI Upload Wait", "PDI Uploaded",
                   "ASN Created", "ASN Number Captured"):
            assert ev in events, f"missing log event {ev}; got {events}"
        assert "before_submit" in rec.get("screenshots", {})
        assert "after_success" in rec.get("screenshots", {})

        # MD should be updated
        md_check = requests.get(f"{API}/master-dispatch/{md_id}", headers=H)
        if md_check.status_code == 200:
            j = md_check.json()
            assert j.get("asn_number") == rec["asn_number"]
            assert j.get("status") == "ready_for_eway"

    def test_03b_cancel_pdi_wait_does_not_submit(self, H):
        inv = f"TEST/9250-{int(time.time())}"
        seed_md(H, inv)
        requests.post(f"{API}/asn/import", headers=H)
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        rid = rec["id"]
        requests.put(f"{API}/asn/records/{rid}", headers=H, json={
            "po_number": "5540022222", "transporter": "V.R.L. LOGISTICS LIMITED",
            "basic_amount": 100000, "total_amount": 118000,
        })
        wait_run_idle(H)
        r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        if r.status_code == 409:
            wait_run_idle(H)
            r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        assert r.status_code == 200
        wait_awaiting_pdi(H)
        r = requests.post(f"{API}/asn/pdi-wait/cancel", headers=H, json={"record_id": rid})
        assert r.status_code == 200, r.text
        wait_run_done(H)
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        assert rec["status"] == "Failed", rec["status"]
        assert "cancel" in (rec.get("error_message") or "").lower()
        assert rec["asn_number"] == "", "ASN must NOT be submitted after cancel"
        # no pending wait anymore -> 409
        r = requests.post(f"{API}/asn/pdi-wait/confirm", headers=H, json={"record_id": rid})
        assert r.status_code == 409

    def test_04_failure_and_retry(self, H):
        inv = f"TEST/9300-{int(time.time())}"
        seed_md(H, inv)
        requests.post(f"{API}/asn/import", headers=H)
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        rid = rec["id"]
        # PO contains NOPO -> simulate dropdown mismatch (fails before the PDI stage)
        r = requests.put(f"{API}/asn/records/{rid}", headers=H, json={
            "po_number": "NOPO123", "transporter": "V.R.L. LOGISTICS LIMITED",
            "basic_amount": 100000, "total_amount": 118000,
        })
        assert r.status_code == 200
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        assert rec["status"] == "Ready"

        # Run - expect failure
        wait_run_idle(H)
        r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        if r.status_code == 409:
            wait_run_idle(H)
            r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        assert r.status_code == 200
        wait_run_done(H)
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        assert rec["status"] == "Failed", f"expected Failed got {rec['status']}"
        assert "not found" in (rec.get("error_message") or "").lower() or "dropdown" in (rec.get("error_message") or "").lower()
        assert "after_failure" in rec.get("screenshots", {})

        # Fix PO and retry via /run — now pauses at PDI stage
        r = requests.put(f"{API}/asn/records/{rid}", headers=H, json={
            "po_number": "5540099999", "transporter": "V.R.L. LOGISTICS LIMITED",
            "basic_amount": 100000, "total_amount": 118000,
        })
        assert r.status_code == 200
        wait_run_idle(H)
        r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        if r.status_code == 409:
            wait_run_idle(H)
            r = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        assert r.status_code == 200
        wait_awaiting_pdi(H)
        confirm_pdi(H, rid)
        wait_run_done(H)
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        assert rec["status"] == "Completed", f"expected Completed got {rec['status']} err={rec.get('error_message')}"

    def test_05_run_concurrency_conflict(self, H):
        # start a run then immediately try another -> 409
        # seed a Ready record
        inv = f"TEST/9400-{int(time.time())}"
        seed_md(H, inv)
        requests.post(f"{API}/asn/import", headers=H)
        rec = requests.get(f"{API}/asn/records", headers=H, params={"search": inv}).json()["items"][0]
        rid = rec["id"]
        requests.put(f"{API}/asn/records/{rid}", headers=H, json={
            "po_number": "5540088888", "transporter": "V.R.L. LOGISTICS LIMITED",
            "basic_amount": 100000, "total_amount": 118000,
        })
        r1 = requests.post(f"{API}/asn/run", headers=H, json={"ids": [rid]})
        assert r1.status_code == 200
        # immediately fire another
        r2 = requests.post(f"{API}/asn/run-ready", headers=H)
        # either 409 (in progress) or 400 (no records if the one Ready is now Processing)
        assert r2.status_code in (400, 409), f"expected 409/400, got {r2.status_code} {r2.text}"
        wait_awaiting_pdi(H)
        confirm_pdi(H, rid)
        wait_run_done(H)

    def test_06_export_xlsx(self, H):
        r = requests.get(f"{API}/asn/export", headers=H)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 100

    def test_07_records_filter_search(self, H):
        r = requests.get(f"{API}/asn/records", headers=H, params={"status": "Completed"})
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["status"] == "Completed"

    def test_08_md_ocr_fields_present(self, H):
        r = requests.get(f"{API}/master-dispatch", headers=H)
        assert r.status_code == 200
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        assert items, "no master_dispatch records"
        target = [i for i in items if i.get("invoice_number") == "26-27/1032"]
        if target:
            t = target[0]
            assert t.get("po_number") == "5540005952"
            assert t.get("asn_number") == "ASN2026071401"
        # All records should have the fields at least present as keys
        for it in items[:5]:
            assert "po_number" in it
            assert "asn_number" in it
            assert "plant" in it
