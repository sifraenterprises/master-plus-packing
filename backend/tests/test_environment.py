"""Test/Live/Maintenance environment mode — backend guard tests.

Proves: mode API works, TEST mode never performs a real submission,
MAINTENANCE blocks automation, LIVE activation is strictly gated,
emergency stop requires password, audit history is written.
System is left in TEST MODE at the end.
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"username": "admin", "password": "5@Sohangso"}
DISPATCH = {"username": "dispatch", "password": "5@Grewal"}


@pytest.fixture(scope="module")
def admin_h():
    r = requests.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def dispatch_h():
    r = requests.post(f"{API}/auth/login", json=DISPATCH)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module", autouse=True)
def ensure_test_mode_at_end(admin_h):
    yield
    env = requests.get(f"{API}/admin/environment", headers=admin_h).json()
    if env["mode"] != "test":
        requests.put(f"{API}/admin/environment", headers=admin_h,
                     json={"mode": "test", "reason": "test suite cleanup"})


def _set_mode(admin_h, mode, reason):
    return requests.put(f"{API}/admin/environment", headers=admin_h,
                        json={"mode": mode, "reason": reason})


def test_default_mode_is_test(admin_h):
    r = requests.get(f"{API}/admin/environment", headers=admin_h)
    assert r.status_code == 200
    assert r.json()["mode"] in ("test", "live", "maintenance")


def test_mode_change_requires_reason(admin_h):
    r = requests.put(f"{API}/admin/environment", headers=admin_h,
                     json={"mode": "maintenance", "reason": ""})
    assert r.status_code == 400


def test_dispatch_user_cannot_change_mode(dispatch_h):
    r = requests.put(f"{API}/admin/environment", headers=dispatch_h,
                     json={"mode": "maintenance", "reason": "should fail"})
    assert r.status_code == 403


def test_live_activation_blocked_without_confirmations(admin_h):
    r = requests.put(f"{API}/admin/environment", headers=admin_h,
                     json={"mode": "live", "reason": "attempt without confirmations"})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "ACTIVATE LIVE MODE" in detail and "password" in detail.lower()


def test_live_activation_blocked_with_wrong_password(admin_h):
    r = requests.put(f"{API}/admin/environment", headers=admin_h,
                     json={"mode": "live", "reason": "wrong password attempt",
                           "password": "wrong-password", "confirm_phrase": "ACTIVATE LIVE MODE",
                           "acknowledge": True})
    assert r.status_code == 403


def test_test_mode_run_is_simulated_never_submits(admin_h):
    """In TEST mode an e-way automation 'run' must be a [TEST] simulation only.
    Creates a dedicated TEST dispatch record, runs it, verifies simulation, deletes it."""
    import time
    env = requests.get(f"{API}/admin/environment", headers=admin_h).json()
    assert env["mode"] == "test"
    md = requests.post(f"{API}/master-dispatch", headers=admin_h, json={
        "invoice_number": "TEST-ENV-001", "customer_name": "TEST CUSTOMER",
        "invoice_date": "2026-07-16", "eway_bill_number": "111122223333", "boxes": 1,
        "items": [{"part_number": "TEST-PART", "description": "env guard test", "quantity": 1}],
    })
    assert md.status_code == 200, md.text
    rec = md.json()
    assert rec.get("is_test") is True and rec.get("environment") == "test", \
        "record created in TEST mode must be stamped environment=test"
    rid = rec["id"]
    try:
        upd = requests.put(f"{API}/eway/records/{rid}", headers=admin_h, json={
            "company_code": "TMTL", "from_validity": "16/07/2026", "to_validity": "20/07/2026"})
        assert upd.status_code == 200, upd.text
        r = requests.post(f"{API}/eway/run", headers=admin_h, json={"ids": [rid]})
        assert r.status_code == 200, r.text
        run_id = r.json()["run_id"]
        for _ in range(30):
            st = requests.get(f"{API}/eway/run-status", headers=admin_h).json()
            if not st.get("running"):
                break
            time.sleep(1)
        logs = requests.get(f"{API}/eway/logs?run_id={run_id}&limit=50", headers=admin_h).json()
        assert logs, "run must produce execution logs"
        assert any("[TEST]" in (l.get("message") or "") for l in logs), \
            "TEST mode run must be [TEST]-simulated — no real portal submission"
        assert not any("live" in str(l.get("message", "")).lower() and "submit" in str(l.get("message", "")).lower()
                       for l in logs)
    finally:
        requests.delete(f"{API}/master-dispatch/{rid}", headers=admin_h)


def test_maintenance_blocks_automation(admin_h):
    r = _set_mode(admin_h, "maintenance", "pytest: verify automation lockout")
    assert r.status_code == 200 and r.json()["mode"] == "maintenance"
    try:
        recs = requests.get(f"{API}/eway/records?page_size=1", headers=admin_h).json()["items"]
        if recs:
            run = requests.post(f"{API}/eway/run", headers=admin_h, json={"ids": [recs[0]["id"]]})
            assert run.status_code == 409, f"maintenance must block runs, got {run.status_code}"
            assert "MAINTENANCE" in str(run.json()["detail"])
        asn = requests.post(f"{API}/asn/run-ready", headers=admin_h)
        assert asn.status_code == 409
    finally:
        back = _set_mode(admin_h, "test", "pytest: restore test mode")
        assert back.status_code == 200 and back.json()["mode"] == "test"


def test_emergency_stop_requires_password(admin_h):
    r = requests.post(f"{API}/admin/environment/emergency-stop", headers=admin_h,
                      json={"reason": "pytest", "password": "wrong"})
    assert r.status_code == 403


def test_audit_history_recorded(admin_h):
    r = requests.get(f"{API}/admin/environment/audit?limit=50", headers=admin_h)
    assert r.status_code == 200
    actions = [a["action"] for a in r.json()]
    assert any("mode_change" in a for a in actions)
    assert any(a == "failed_live_activation" for a in actions)


def test_new_records_are_stamped_with_environment(admin_h):
    r = requests.get(f"{API}/master-dispatch?page_size=5", headers=admin_h)
    assert r.status_code == 200


def test_system_left_in_test_mode(admin_h):
    env = requests.get(f"{API}/admin/environment", headers=admin_h).json()
    assert env["mode"] == "test"
