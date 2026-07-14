"""
Vendor E-Way Bill Acknowledgement module + Master Dispatch plants/asn/plant fields
+ regression checks for e-way, master-dispatch, packing, dispatch.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://invoice-master-295.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin", "5@Sohangso")


@pytest.fixture(scope="module")
def dispatch_token():
    return _login("dispatch", "5@Grewal")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _create_md(admin_token, asn, transporter="VRL LOGISTICS", plant="TMTL - Production - Bhopal-700",
               invoice_prefix="TEST_VACK"):
    payload = {
        "customer_name": "Test Customer",
        "customer_code": "TMTL",
        "gstin": "27AABCT1234A1Z5",
        "invoice_number": f"{invoice_prefix}-{int(time.time()*1000)}",
        "invoice_date": "2026-01-01",
        "transporter_name": transporter,
        "asn_number": asn,
        "plant": plant,
        "items": [{"part_number": "P1", "description": "x", "quantity": 1, "unit": "NOS", "rate": 100, "amount": 100}],
    }
    r = requests.post(f"{API}/master-dispatch", headers=_hdr(admin_token), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _wait_run_idle(admin_token, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        r = requests.get(f"{API}/vendor-ack/run-status", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        if not r.json().get("running"):
            return r.json()
        time.sleep(0.5)
    raise TimeoutError("run-status still running")


def _run_and_wait(admin_token, dispatch_id, expected_wait=15):
    _wait_run_idle(admin_token)
    r = requests.post(f"{API}/vendor-ack/run", headers=_hdr(admin_token),
                      json={"dispatch_id": dispatch_id, "company_code": "TMTL"}, timeout=30)
    assert r.status_code == 200, r.text
    ack_id = r.json()["ack_id"]
    end = time.time() + expected_wait
    while time.time() < end:
        rs = requests.get(f"{API}/vendor-ack/run-status", headers=_hdr(admin_token), timeout=10).json()
        if not rs.get("running"):
            break
        time.sleep(0.5)
    ack = requests.get(f"{API}/vendor-ack/acks/{ack_id}", headers=_hdr(admin_token), timeout=10).json()
    return ack_id, ack


# -------------------- Plants master --------------------

class TestPlants:
    def test_plants_seeded_returns_defaults(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/plants", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        plants = r.json()
        assert isinstance(plants, list) and len(plants) >= 2
        assert "TMTL - Production - Bhopal-700" in plants
        assert "TAFE MOTORS AND TRACTORS LTD.-7075" in plants

    def test_dispatch_cannot_add_plant(self, dispatch_token):
        r = requests.post(f"{API}/master-dispatch/plants", headers=_hdr(dispatch_token),
                          json={"name": "TEST_PLANT_DISPATCH"}, timeout=10)
        assert r.status_code == 403

    def test_admin_can_add_plant(self, admin_token):
        name = f"TEST_PLANT_{int(time.time())}"
        r = requests.post(f"{API}/master-dispatch/plants", headers=_hdr(admin_token),
                          json={"name": name}, timeout=10)
        assert r.status_code == 200
        assert r.json()["name"] == name
        # Verify persisted
        plants = requests.get(f"{API}/master-dispatch/plants", headers=_hdr(admin_token)).json()
        assert name in plants


# -------------------- Master Dispatch asn_number + plant fields --------------------

class TestMDAsnPlant:
    def test_create_and_get_with_asn_plant(self, admin_token):
        md = _create_md(admin_token, asn="TEST_ASN_FIELD1")
        assert md["asn_number"] == "TEST_ASN_FIELD1"
        assert md["plant"] == "TMTL - Production - Bhopal-700"
        r = requests.get(f"{API}/master-dispatch/{md['id']}", headers=_hdr(admin_token))
        assert r.status_code == 200
        got = r.json()
        assert got["asn_number"] == "TEST_ASN_FIELD1"
        assert got["plant"] == "TMTL - Production - Bhopal-700"

    def test_update_asn_plant(self, admin_token):
        md = _create_md(admin_token, asn="ASN_ORIG")
        upd = {**md, "asn_number": "ASN_NEW", "plant": "TAFE MOTORS AND TRACTORS LTD.-7075"}
        # MasterDispatchInput fields only
        payload = {k: upd[k] for k in ("customer_name", "customer_code", "gstin", "invoice_number",
                    "invoice_date", "transporter_name", "asn_number", "plant", "items", "status", "verified")}
        r = requests.put(f"{API}/master-dispatch/{md['id']}", headers=_hdr(admin_token), json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["asn_number"] == "ASN_NEW"
        assert r.json()["plant"] == "TAFE MOTORS AND TRACTORS LTD.-7075"


# -------------------- vendor-ack endpoints --------------------

class TestVendorAck:
    def test_records_list_shape(self, admin_token):
        r = requests.get(f"{API}/vendor-ack/records", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "total" in data
        if data["items"]:
            row = data["items"][0]
            for k in ("dispatch_id", "dispatch_no", "invoice_number", "asn_number",
                      "transporter", "plant", "ack_status"):
                assert k in row

    def test_records_search_filter(self, admin_token):
        md = _create_md(admin_token, asn="ASN_SEARCH_UNIQ_X1")
        r = requests.get(f"{API}/vendor-ack/records?search=ASN_SEARCH_UNIQ_X1",
                         headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["asn_number"] == "ASN_SEARCH_UNIQ_X1" for x in items)

    def test_stats(self, admin_token):
        r = requests.get(f"{API}/vendor-ack/stats", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "pending", "completed", "retry_scheduled", "failed"):
            assert k in d

    def test_run_happy_path_completed(self, admin_token):
        md = _create_md(admin_token, asn="ASNTEST100")
        ack_id, ack = _run_and_wait(admin_token, md["id"])
        assert ack["status"] == "Completed", ack
        assert ack.get("ack_date")
        shots = ack.get("screenshots") or {}
        assert "before_submit" in shots and "after_success" in shots
        events = [e["event"] for e in ack.get("execution_log", [])]
        assert events.count("Dropdown Selected") >= 3
        assert "Field Entered" in events
        assert "Checkbox Ticked" in events
        assert "Success" in events
        # Master dispatch synced
        md_after = requests.get(f"{API}/master-dispatch/{md['id']}", headers=_hdr(admin_token)).json()
        assert md_after["vendor_ack_status"] == "Completed"

    def test_run_asn_not_found_stays_pending(self, admin_token):
        md = _create_md(admin_token, asn="NOTFOUND_ASN_1")
        ack_id, ack = _run_and_wait(admin_token, md["id"])
        assert ack["status"] == "Pending"
        assert ack.get("portal_message") == "ASN Details Not Found"
        assert "after_failure" in (ack.get("screenshots") or {})
        # retry endpoint should work (still allowed for Pending)
        r = requests.post(f"{API}/vendor-ack/retry/{ack_id}", headers=_hdr(admin_token))
        assert r.status_code == 200, r.text
        _wait_run_idle(admin_token)

    def test_run_already_acked_completed_no_retry(self, admin_token):
        md = _create_md(admin_token, asn="ACKED_ASN_1")
        ack_id, ack = _run_and_wait(admin_token, md["id"])
        assert ack["status"] == "Completed"
        assert "already" in (ack.get("portal_message") or "").lower()
        r = requests.post(f"{API}/vendor-ack/retry/{ack_id}", headers=_hdr(admin_token))
        assert r.status_code == 400

    def test_run_err_retries_and_scheduled(self, admin_token):
        md = _create_md(admin_token, asn="ERR_ASN_1")
        ack_id, ack = _run_and_wait(admin_token, md["id"])
        assert ack["status"] == "Retry Scheduled", ack
        events = [e["event"] for e in ack.get("execution_log", [])]
        assert events.count("Retry") == 2, events
        assert "after_failure" in (ack.get("screenshots") or {})

    def test_run_bad_dropdown_failed(self, admin_token):
        md = _create_md(admin_token, asn="ASNGOOD1", transporter="BADDROP TRANS")
        ack_id, ack = _run_and_wait(admin_token, md["id"])
        assert ack["status"] == "Failed"
        assert "Dropdown Value Not Found" in (ack.get("portal_message") or "")

    def test_run_blank_asn_400(self, admin_token):
        # create MD with blank ASN
        payload = {
            "customer_name": "x", "customer_code": "TMTL", "gstin": "", "invoice_number": f"TEST_BLANK_{int(time.time()*1000)}",
            "invoice_date": "2026-01-01", "transporter_name": "VRL", "asn_number": "", "plant": "TMTL - Production - Bhopal-700",
            "items": [{"part_number": "P", "quantity": 1, "rate": 1, "amount": 1}],
        }
        md = requests.post(f"{API}/master-dispatch", headers=_hdr(admin_token), json=payload).json()
        _wait_run_idle(admin_token)
        r = requests.post(f"{API}/vendor-ack/run", headers=_hdr(admin_token),
                          json={"dispatch_id": md["id"]}, timeout=15)
        assert r.status_code == 400
        assert "ASN" in r.json().get("detail", "")

    def test_screenshots_endpoint(self, admin_token):
        # Use happy path record's after_success screenshot
        md = _create_md(admin_token, asn="ASNSHOT1")
        ack_id, ack = _run_and_wait(admin_token, md["id"])
        shots = ack.get("screenshots") or {}
        name = (shots.get("after_success") or "").split("/")[-1]
        assert name
        r = requests.get(f"{API}/vendor-ack/screenshots/{name}",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")

    def test_logs_endpoint(self, admin_token):
        r = requests.get(f"{API}/vendor-ack/logs?limit=20", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# -------------------- Regression --------------------

class TestRegression:
    def test_eway_stats(self, admin_token):
        r = requests.get(f"{API}/eway/stats", headers=_hdr(admin_token))
        assert r.status_code == 200

    def test_eway_records(self, admin_token):
        r = requests.get(f"{API}/eway/records", headers=_hdr(admin_token))
        assert r.status_code == 200

    def test_eway_validation_test_run(self, admin_token):
        _wait_run_idle(admin_token)
        r = requests.post(f"{API}/eway/validation/test-run", headers=_hdr(admin_token), timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        # 11/11 all_ok
        assert d.get("all_ok") is True, d
        checks = d.get("results") or d.get("checks") or []
        assert len(checks) >= 11

    def test_md_stats_and_list(self, admin_token):
        assert requests.get(f"{API}/master-dispatch/stats", headers=_hdr(admin_token)).status_code == 200
        assert requests.get(f"{API}/master-dispatch?page=1&page_size=5", headers=_hdr(admin_token)).status_code == 200

    def test_md_export_excel(self, admin_token):
        r = requests.get(f"{API}/master-dispatch/export/excel", headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")

    def test_packing_slips(self, admin_token):
        r = requests.get(f"{API}/packing/slips", headers=_hdr(admin_token))
        assert r.status_code == 200

    def test_dispatch_list(self, admin_token):
        r = requests.get(f"{API}/dispatch", headers=_hdr(admin_token))
        assert r.status_code == 200
