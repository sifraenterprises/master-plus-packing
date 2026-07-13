"""Backend tests for the E-Way Bill module."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invoice-master-295.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "admin", "password": "5@Sohangso"}
DISPATCH = {"username": "dispatch", "password": "5@Grewal"}


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


def _create_md(admin_token, dispatch_no_suffix, eway_bill_number, verified=True):
    payload = {
        "customer_name": f"TEST_EWAY_{dispatch_no_suffix}",
        "gstin": "27ABCDE1234F1Z5",
        "invoice_number": f"TEST-EWAY-INV-{dispatch_no_suffix}",
        "invoice_date": "2026-01-15",
        "items": [{"part_number": "P-1", "description": "d", "quantity": 1, "rate": 10, "amount": 10}],
        "invoice_total": 10.0,
        "status": "ready_for_eway",
        "eway_bill_number": eway_bill_number,
        "verified": verified,
    }
    r = requests.post(f"{API}/master-dispatch", json=payload, headers=_auth(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _wait_for_run_done(admin_token, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"{API}/eway/run-status", headers=_auth(admin_token), timeout=10)
        if r.status_code == 200 and not r.json().get("running"):
            return r.json()
        time.sleep(1)
    return None


def _wait_for_status(admin_token, record_id, expected, timeout=30):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = requests.get(f"{API}/eway/records?page_size=200", headers=_auth(admin_token), timeout=10)
        items = r.json().get("items", [])
        rec = next((x for x in items if x["id"] == record_id), None)
        if rec:
            last = rec
            if rec["eway_status"] == expected:
                return rec
        time.sleep(1)
    return last


CREATED_IDS = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_token):
    yield
    for rid in CREATED_IDS:
        try:
            requests.delete(f"{API}/master-dispatch/{rid}", headers=_auth(admin_token), timeout=10)
        except Exception:
            pass


class TestStats:
    def test_requires_auth(self):
        r = requests.get(f"{API}/eway/stats", timeout=10)
        assert r.status_code == 401

    def test_stats_shape(self, admin_token):
        r = requests.get(f"{API}/eway/stats", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "pending", "completed", "failed"):
            assert k in d and isinstance(d[k], int)


class TestRecordsList:
    def test_records_default(self, admin_token):
        r = requests.get(f"{API}/eway/records", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("items", "total", "page", "pages"):
            assert k in d
        if d["items"]:
            keys = {"id", "dispatch_no", "invoice_no", "eway_bill_number", "company_code",
                    "from_validity", "to_validity", "eway_status", "retry_count"}
            assert keys.issubset(d["items"][0].keys())

    def test_filters(self, admin_token):
        r = requests.get(f"{API}/eway/records?status=Pending&invoice=INV&dispatch=GEW",
                         headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200


class TestUpdateDetails:
    def test_update_details(self, admin_token):
        rec = _create_md(admin_token, "UPD01", "351099998888")
        CREATED_IDS.append(rec["id"])
        body = {"company_code": "TMTL", "from_validity": "15/01/2026", "to_validity": "20/01/2026"}
        r = requests.put(f"{API}/eway/records/{rec['id']}", json=body, headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["company_code"] == "TMTL"
        assert d["from_validity"] == "15/01/2026"
        assert d["to_validity"] == "20/01/2026"

    def test_invalid_id(self, admin_token):
        r = requests.put(f"{API}/eway/records/notanid",
                         json={"company_code": "TMTL", "from_validity": "1/1/2026", "to_validity": "2/1/2026"},
                         headers=_auth(admin_token), timeout=10)
        assert r.status_code == 400


class TestRunSuccess:
    def test_run_completes_and_syncs_md(self, admin_token):
        rec = _create_md(admin_token, "RUN01", "351012345678")
        CREATED_IDS.append(rec["id"])
        requests.put(f"{API}/eway/records/{rec['id']}",
                     json={"company_code": "TMTL", "from_validity": "15/01/2026", "to_validity": "20/01/2026"},
                     headers=_auth(admin_token), timeout=10)
        # Wait for any prior run
        _wait_for_run_done(admin_token, timeout=10)
        r = requests.post(f"{API}/eway/run", json={"ids": [rec["id"]]}, headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        _wait_for_run_done(admin_token, timeout=30)
        final = _wait_for_status(admin_token, rec["id"], "Completed", timeout=15)
        assert final is not None, "record not found after run"
        assert final["eway_status"] == "Completed"
        assert final["submitted_by"] == "admin"
        # Master dispatch status became 'completed'
        md = requests.get(f"{API}/master-dispatch/{rec['id']}", headers=_auth(admin_token), timeout=10).json()
        assert md["status"] == "completed"


class TestSkipRule:
    def test_skip_blank_eway(self, admin_token):
        rec = _create_md(admin_token, "SKIP01", "")
        CREATED_IDS.append(rec["id"])
        _wait_for_run_done(admin_token, timeout=15)
        r = requests.post(f"{API}/eway/run", json={"ids": [rec["id"]]}, headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        _wait_for_run_done(admin_token, timeout=15)
        # Check submission has 'Skipped' error and still Pending
        recs = requests.get(f"{API}/eway/records?page_size=200", headers=_auth(admin_token), timeout=10).json()["items"]
        r2 = next((x for x in recs if x["id"] == rec["id"]), None)
        assert r2 is not None
        assert r2["eway_status"] == "Pending"
        assert (r2.get("error") or "").startswith("Skipped")

    def test_skip_blank_validity(self, admin_token):
        rec = _create_md(admin_token, "SKIP02", "351099990000")
        CREATED_IDS.append(rec["id"])
        _wait_for_run_done(admin_token, timeout=15)
        r = requests.post(f"{API}/eway/run", json={"ids": [rec["id"]]}, headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        _wait_for_run_done(admin_token, timeout=15)
        recs = requests.get(f"{API}/eway/records?page_size=200", headers=_auth(admin_token), timeout=10).json()["items"]
        r2 = next(x for x in recs if x["id"] == rec["id"])
        assert r2["eway_status"] == "Pending"
        assert (r2.get("error") or "").startswith("Skipped")


class TestFailurePath:
    def test_fails_after_retries(self, admin_token):
        rec = _create_md(admin_token, "ERR01", "ERR-BAD-BILL")
        CREATED_IDS.append(rec["id"])
        requests.put(f"{API}/eway/records/{rec['id']}",
                     json={"company_code": "TMTL", "from_validity": "15/01/2026", "to_validity": "20/01/2026"},
                     headers=_auth(admin_token), timeout=10)
        _wait_for_run_done(admin_token, timeout=15)
        r = requests.post(f"{API}/eway/run", json={"ids": [rec["id"]]}, headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        _wait_for_run_done(admin_token, timeout=30)
        final = _wait_for_status(admin_token, rec["id"], "Failed", timeout=15)
        assert final is not None
        assert final["eway_status"] == "Failed"
        assert final["retry_count"] >= 1
        assert final.get("screenshot")

    def test_retry_failed_endpoint(self, admin_token):
        _wait_for_run_done(admin_token, timeout=15)
        r = requests.post(f"{API}/eway/retry-failed", headers=_auth(admin_token), timeout=10)
        # Either 200 with ids, or 400 if no failed
        assert r.status_code in (200, 400)
        if r.status_code == 200:
            _wait_for_run_done(admin_token, timeout=45)


class TestConcurrency:
    def test_run_status_endpoint(self, admin_token):
        r = requests.get(f"{API}/eway/run-status", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert "running" in r.json()


class TestValidationRun:
    def test_test_validation_admin(self, admin_token):
        _wait_for_run_done(admin_token, timeout=15)
        r = requests.post(f"{API}/eway/validation/test-run", headers=_auth(admin_token), timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["all_ok"] is True, f"checks: {d.get('checks')}"
        assert d["passed"] == d["total"] == 11
        # Ensure Master Dispatch sync check present
        names = [c["check"] for c in d["checks"]]
        assert "Master Dispatch sync" in names

    def test_test_validation_forbidden_for_dispatch(self, dispatch_token):
        r = requests.post(f"{API}/eway/validation/test-run", headers=_auth(dispatch_token), timeout=15)
        assert r.status_code == 403


class TestSettings:
    def test_settings_shows_missing_env(self, admin_token):
        r = requests.get(f"{API}/eway/settings", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["mode"] == "test"
        assert set(d["missing_env"]) >= {"TAFE_PORTAL_URL", "TAFE_USERNAME", "TAFE_PASSWORD"}

    def test_live_mode_rejected(self, admin_token):
        r = requests.post(f"{API}/eway/settings/mode", json={"mode": "live"},
                          headers=_auth(admin_token), timeout=10)
        assert r.status_code == 400
        # Confirm still test
        r2 = requests.get(f"{API}/eway/settings", headers=_auth(admin_token), timeout=10)
        assert r2.json()["mode"] == "test"


class TestSelectorsAndExport:
    def test_get_selectors(self, admin_token):
        r = requests.get(f"{API}/eway/selectors", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "login" in d and "eway" in d

    def test_put_selectors_forbidden_dispatch(self, dispatch_token, admin_token):
        current = requests.get(f"{API}/eway/selectors", headers=_auth(admin_token), timeout=10).json()
        r = requests.put(f"{API}/eway/selectors", json=current, headers=_auth(dispatch_token), timeout=10)
        assert r.status_code == 403

    def test_export_xlsx(self, admin_token):
        r = requests.get(f"{API}/eway/export", headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 200

    def test_logs(self, admin_token):
        r = requests.get(f"{API}/eway/logs?limit=50", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


class TestRegression:
    def test_master_dispatch_stats(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/stats", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200

    def test_master_dispatch_list(self, admin_token):
        r = requests.get(f"{API}/master-dispatch", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_dispatch(self, admin_token):
        r = requests.get(f"{API}/dispatch", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200

    def test_packing_slips(self, admin_token):
        r = requests.get(f"{API}/packing/slips", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200

    def test_modules_eway_active(self, admin_token):
        r = requests.get(f"{API}/modules", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        mods = r.json()
        eway = next((m for m in mods if m.get("id") == "eway-bill" or "eway" in (m.get("id") or "").lower()
                     or "e-way" in (m.get("name") or "").lower()), None)
        assert eway is not None, f"eway module not found in {mods}"
        assert eway.get("status") == "active", f"eway status: {eway}"
