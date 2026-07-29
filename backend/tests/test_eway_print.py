"""Print E-Way Bill module tests — read-only print jobs with manual login pause.
Runs in TEST mode: simulated portal, no real government-portal contact."""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"username": "admin", "password": "5@Sohangso"}


@pytest.fixture(scope="module")
def H():
    r = requests.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def seed_md(H, invoice_no, ewb):
    r = requests.post(f"{API}/master-dispatch", headers=H, json={
        "invoice_number": invoice_no, "invoice_date": "2026-07-17",
        "customer_name": "TEST CUSTOMER", "eway_bill_number": ewb, "boxes": 1,
        "items": [{"part_number": "TEST-PRINT-PART", "description": "print test", "quantity": 1}],
    })
    assert r.status_code == 200, r.text
    return r.json()


def get_job(H, ewb):
    items = requests.get(f"{API}/eway-print/records", headers=H,
                         params={"search": ewb}).json()["items"]
    return items[0] if items else None


def wait_idle(H, timeout=120):
    start = time.time()
    while time.time() - start < timeout:
        rs = requests.get(f"{API}/eway-print/run-status", headers=H).json()
        if not rs.get("running"):
            return rs
        if rs.get("awaiting_login"):
            requests.post(f"{API}/eway-print/login-wait/confirm", headers=H)
        rv = rs.get("awaiting_review")
        if rv:
            requests.post(f"{API}/eway-print/review-wait/confirm", headers=H,
                          json={"record_id": rv["record_id"]})
        time.sleep(0.5)
    raise AssertionError("run never finished")


def wait_for(H, key, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        rs = requests.get(f"{API}/eway-print/run-status", headers=H).json()
        if rs.get(key):
            return rs
        if not rs.get("running"):
            raise AssertionError(f"run finished before {key} appeared: {rs}")
        time.sleep(0.5)
    raise AssertionError(f"{key} was never set")


def test_import_creates_jobs_and_skips_invalid(H):
    ts = int(time.time())
    seed_md(H, f"TEST/PRN-{ts}", "123412341234")
    seed_md(H, f"TEST/PRN-BAD-{ts}", "12341234")  # invalid: 8 digits
    r = requests.post(f"{API}/eway-print/import", headers=H)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["created"] >= 1
    assert d["skipped_invalid"] >= 1
    job = get_job(H, "123412341234")
    assert job and job["status"] == "Pending" and job["job_type" if "job_type" in job else "status"]
    # re-import is idempotent
    d2 = requests.post(f"{API}/eway-print/import", headers=H).json()
    jobs = requests.get(f"{API}/eway-print/records", headers=H,
                        params={"search": "123412341234"}).json()["items"]
    assert len(jobs) == 1


def test_run_pauses_for_manual_login_then_completes_with_pdf(H):
    wait_idle(H)
    job = get_job(H, "123412341234")
    r = requests.post(f"{API}/eway-print/run", headers=H,
                      json={"ids": [job["id"]], "stop_before_download": False})
    assert r.status_code == 200, r.text
    rs = wait_for(H, "awaiting_login")
    assert rs["phase"] == "Waiting for manual portal login"
    assert rs["awaiting_login"].get("timeout_seconds")
    job = get_job(H, "123412341234")
    assert job["status"] == "Waiting for Portal Login"
    # user completes CAPTCHA/OTP manually, then confirms
    r = requests.post(f"{API}/eway-print/login-wait/confirm", headers=H)
    assert r.status_code == 200
    wait_idle(H)
    job = get_job(H, "123412341234")
    assert job["status"] == "Completed", job
    assert job["has_pdf"] and job["pdf_name"].startswith("EWB_")
    # PDF downloadable
    r = requests.get(f"{API}/eway-print/records/{job['id']}/pdf", headers=H)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    # execution log recorded with [TEST] simulation markers and manual-login events
    logs = requests.get(f"{API}/eway-print/logs", headers=H, params={"limit": 100}).json()
    msgs = " | ".join(l["message"] for l in logs)
    assert "Manual Login Wait" in {l["event"] for l in logs}
    assert "[TEST]" in msgs, "TEST mode run must be simulated"
    assert "never automated" in msgs.lower() or "manually" in msgs.lower()


def test_stop_before_download_pauses_for_review(H):
    ts = int(time.time())
    seed_md(H, f"TEST/PRN-REV-{ts}", "567856785678")
    requests.post(f"{API}/eway-print/import", headers=H)
    job = get_job(H, "567856785678")
    r = requests.post(f"{API}/eway-print/run", headers=H,
                      json={"ids": [job["id"]], "stop_before_download": True})
    assert r.status_code == 200, r.text
    wait_for(H, "awaiting_login")
    requests.post(f"{API}/eway-print/login-wait/confirm", headers=H)
    rs = wait_for(H, "awaiting_review")
    rv = rs["awaiting_review"]
    assert rv["eway_bill_number"] == "567856785678"
    job = get_job(H, "567856785678")
    assert job["status"] == "Waiting for Review"
    assert not job["has_pdf"], "PDF must NOT be downloaded before review confirmation"
    r = requests.post(f"{API}/eway-print/review-wait/confirm", headers=H,
                      json={"record_id": rv["record_id"]})
    assert r.status_code == 200
    wait_idle(H)
    job = get_job(H, "567856785678")
    assert job["status"] == "Completed" and job["has_pdf"]


def test_not_found_and_mismatch_fail_safely(H):
    ts = int(time.time())
    seed_md(H, f"TEST/PRN-NF-{ts}", "999912341234")   # TEST sim: not found
    seed_md(H, f"TEST/PRN-MM-{ts}", "998812341234")   # TEST sim: mismatch
    requests.post(f"{API}/eway-print/import", headers=H)
    j1, j2 = get_job(H, "999912341234"), get_job(H, "998812341234")
    r = requests.post(f"{API}/eway-print/run", headers=H,
                      json={"ids": [j1["id"], j2["id"]], "stop_before_download": False})
    assert r.status_code == 200
    wait_for(H, "awaiting_login")
    requests.post(f"{API}/eway-print/login-wait/confirm", headers=H)
    wait_idle(H)
    j1, j2 = get_job(H, "999912341234"), get_job(H, "998812341234")
    assert j1["status"] == "Failed" and "not found" in j1["error_message"].lower()
    assert not j1["has_pdf"], "nothing must be printed for a missing EWB"
    assert j2["status"] == "Failed" and "mismatch" in j2["error_message"].lower()
    assert not j2["has_pdf"], "nothing must be printed on mismatch"


def test_retry_failed_reruns_failed_jobs(H):
    r = requests.post(f"{API}/eway-print/retry-failed", headers=H, json={"stop_before_download": False})
    assert r.status_code == 200, r.text
    wait_for(H, "awaiting_login")
    requests.post(f"{API}/eway-print/login-wait/confirm", headers=H)
    wait_idle(H)
    j1 = get_job(H, "999912341234")
    assert j1["status"] == "Failed" and j1["retry_count"] >= 2


def test_login_cancel_fails_without_printing(H):
    ts = int(time.time())
    seed_md(H, f"TEST/PRN-CXL-{ts}", "111122224444")
    requests.post(f"{API}/eway-print/import", headers=H)
    job = get_job(H, "111122224444")
    requests.post(f"{API}/eway-print/run", headers=H,
                  json={"ids": [job["id"]], "stop_before_download": False})
    wait_for(H, "awaiting_login")
    r = requests.post(f"{API}/eway-print/login-wait/cancel", headers=H)
    assert r.status_code == 200
    wait_idle(H)
    job = get_job(H, "111122224444")
    assert job["status"] == "Failed"
    assert "cancel" in job["error_message"].lower()
    assert not job["has_pdf"]


def test_wait_endpoints_409_when_nothing_waiting(H):
    wait_idle(H)
    assert requests.post(f"{API}/eway-print/login-wait/confirm", headers=H).status_code == 409
    assert requests.post(f"{API}/eway-print/review-wait/confirm", headers=H,
                         json={"record_id": "nope"}).status_code == 409


def test_no_credentials_in_job_payload_or_selectors(H):
    """Safety: government-portal credentials must never appear in jobs or config."""
    items = requests.get(f"{API}/eway-print/records", headers=H, params={"page_size": 100}).json()["items"]
    for j in items:
        blob = str(j).lower()
        assert "password" not in blob and "captcha" not in blob and "otp" not in blob
    sel = requests.get(f"{API}/eway-print/selectors", headers=H).json()
    assert "login_url" in sel
    blob = str(sel).lower()
    assert "password=" not in blob and "username=" not in blob


def test_maintenance_blocks_print_runs(H):
    r = requests.put(f"{API}/admin/environment", headers=H,
                     json={"mode": "maintenance", "reason": "pytest: print eway guard"})
    assert r.status_code == 200
    try:
        job_items = requests.get(f"{API}/eway-print/records", headers=H, params={"page_size": 1}).json()["items"]
        if job_items:
            r = requests.post(f"{API}/eway-print/run", headers=H,
                              json={"ids": [job_items[0]["id"]], "stop_before_download": False})
            assert r.status_code == 409
            assert "MAINTENANCE" in str(r.json()["detail"])
    finally:
        r = requests.put(f"{API}/admin/environment", headers=H,
                         json={"mode": "test", "reason": "pytest: restore test mode"})
        assert r.status_code == 200 and r.json()["mode"] == "test"


def test_cleanup_test_jobs(H):
    """Remove the seeded print jobs and dispatches created by this suite."""
    for ewb in ("123412341234", "567856785678", "999912341234", "998812341234", "111122224444", "12341234"):
        for j in requests.get(f"{API}/eway-print/records", headers=H, params={"search": ewb}).json()["items"]:
            requests.delete(f"{API}/eway-print/records/{j['id']}", headers=H)
    r = requests.get(f"{API}/master-dispatch", headers=H, params={"search": "TEST/PRN", "page_size": 50}).json()
    for rec in r.get("items", []):
        if "TEST/PRN" in (rec.get("invoice_number") or ""):
            requests.delete(f"{API}/master-dispatch/{rec['id']}", headers=H)
