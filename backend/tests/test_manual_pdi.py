"""Tests for Manual PDI Upload + Active PDI feature (iteration 18)."""
import io
import os
import pytest
import requests
from reportlab.pdfgen import canvas

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE_URL}/api"

TARGET_DISPATCH_ID = "6a573d5baca1aebf967b39d9"
ORIGINAL_ACTIVE_REPORT_NO = "PDI-0014"


def _pdf_bytes(text="TEST MANUAL PDI"):
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, text)
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def created_reports():
    ids = []
    yield ids
    # Cleanup - restore original active
    tok = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "5@Sohangso"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    for rid in ids:
        requests.delete(f"{API}/pdi/reports/{rid}", headers=h)
    # Restore original active PDI-0014
    r = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports", headers=h)
    if r.status_code == 200:
        for rep in r.json().get("reports", []):
            if rep.get("report_no") == ORIGINAL_ACTIVE_REPORT_NO:
                requests.post(f"{API}/pdi/reports/{rep['id']}/set-active", headers=h)
                break


class TestManualUpload:
    def test_manual_upload_rejects_non_pdf(self, admin_headers, created_reports):
        files = {"file": ("test.txt", b"not a pdf", "text/plain")}
        r = requests.post(f"{API}/pdi/manual-upload", headers=admin_headers,
                          files=files, data={"part_name": "X"})
        assert r.status_code == 400
        assert "PDF" in r.text

    def test_manual_upload_without_dispatch(self, admin_headers, created_reports):
        files = {"file": ("m.pdf", _pdf_bytes("no dispatch"), "application/pdf")}
        r = requests.post(f"{API}/pdi/manual-upload", headers=admin_headers,
                          files=files, data={"part_name": "TEST_Part", "item_code": "TEST_IC"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["source"] == "manual"
        assert data["status"] == "manual"
        assert data["report_no"].startswith("PDI-")
        assert "id" in data
        created_reports.append(data["id"])

    def test_manual_upload_attaches_as_active(self, admin_headers, created_reports):
        files = {"file": ("md.pdf", _pdf_bytes("attach"), "application/pdf")}
        r = requests.post(f"{API}/pdi/manual-upload", headers=admin_headers,
                          files=files, data={"master_dispatch_id": TARGET_DISPATCH_ID,
                                             "part_name": "TEST_Attach",
                                             "item_code": "TEST_ATT",
                                             "lot_no": "LOT_TEST",
                                             "inspector": "Tester",
                                             "approver": "Approver"})
        assert r.status_code == 200, r.text
        data = r.json()
        rid = data["id"]
        created_reports.append(rid)
        # Verify dispatch attach
        listing = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                               headers=admin_headers).json()
        assert listing["active_id"] == rid
        # source field present
        sources = {rep["source"] for rep in listing["reports"]}
        assert "manual" in sources
        assert "ai" in sources  # existing AI reports still there

    def test_regenerate_manual_returns_400(self, admin_headers, created_reports):
        assert created_reports, "need at least one manual report"
        rid = created_reports[-1]
        r = requests.post(f"{API}/pdi/reports/{rid}/regenerate", headers=admin_headers)
        assert r.status_code == 400
        assert "Manual" in r.text or "manual" in r.text

    def test_get_manual_pdf(self, admin_headers, created_reports):
        rid = created_reports[-1]
        r = requests.get(f"{API}/pdi/reports/{rid}/pdf", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF")


class TestSetActive:
    def test_set_active_switches_between_manual_and_ai(self, admin_headers, created_reports):
        # Get all reports for dispatch
        listing = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                               headers=admin_headers).json()
        reports = listing["reports"]
        ai_report = next((r for r in reports if r["source"] == "ai"
                          and r["report_no"] == ORIGINAL_ACTIVE_REPORT_NO), None)
        manual_report = next((r for r in reports if r["source"] == "manual"), None)
        assert ai_report and manual_report

        # Switch to AI
        r = requests.post(f"{API}/pdi/reports/{ai_report['id']}/set-active", headers=admin_headers)
        assert r.status_code == 200
        listing2 = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                                headers=admin_headers).json()
        assert listing2["active_id"] == ai_report["id"]

        # Verify dispatch pdi_* fields updated
        md = requests.get(f"{API}/master-dispatch/{TARGET_DISPATCH_ID}", headers=admin_headers).json()
        assert md.get("pdi_report_no") == ORIGINAL_ACTIVE_REPORT_NO
        assert md.get("pdi_source") == "ai"
        pdi_docs = [d for d in md.get("documents", []) if d.get("type") == "PDI"]
        assert len(pdi_docs) == 1, "should only be one PDI entry in documents"
        assert pdi_docs[0]["ref_id"] == ai_report["id"]

        # Switch back to manual
        r = requests.post(f"{API}/pdi/reports/{manual_report['id']}/set-active", headers=admin_headers)
        assert r.status_code == 200
        listing3 = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                                headers=admin_headers).json()
        assert listing3["active_id"] == manual_report["id"]
        md2 = requests.get(f"{API}/master-dispatch/{TARGET_DISPATCH_ID}", headers=admin_headers).json()
        assert md2.get("pdi_source") == "manual"


class TestDeleteBehavior:
    def test_delete_non_active_does_not_clear_dispatch(self, admin_headers, created_reports):
        # Ensure manual is active (from previous test). Create another manual, delete it, verify active unchanged.
        files = {"file": ("extra.pdf", _pdf_bytes("extra"), "application/pdf")}
        r = requests.post(f"{API}/pdi/manual-upload", headers=admin_headers,
                          files=files, data={"master_dispatch_id": TARGET_DISPATCH_ID,
                                             "part_name": "TEST_Extra"})
        extra = r.json()
        created_reports.append(extra["id"])
        active_now = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                                  headers=admin_headers).json()["active_id"]
        # newly uploaded becomes active — so switch active to something else first
        listing = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                               headers=admin_headers).json()
        other = next(r for r in listing["reports"] if r["id"] != extra["id"])
        requests.post(f"{API}/pdi/reports/{other['id']}/set-active", headers=admin_headers)
        active_before = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                                     headers=admin_headers).json()["active_id"]
        assert active_before == other["id"]

        # Now delete the non-active extra
        rd = requests.delete(f"{API}/pdi/reports/{extra['id']}", headers=admin_headers)
        assert rd.status_code == 200
        created_reports.remove(extra["id"])

        active_after = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                                    headers=admin_headers).json()["active_id"]
        assert active_after == active_before, "deleting non-active should not clear active"

    def test_delete_active_clears_dispatch(self, admin_headers, created_reports):
        # Upload a manual, make sure it is active, then delete it
        files = {"file": ("act.pdf", _pdf_bytes("active"), "application/pdf")}
        r = requests.post(f"{API}/pdi/manual-upload", headers=admin_headers,
                          files=files, data={"master_dispatch_id": TARGET_DISPATCH_ID,
                                             "part_name": "TEST_Active"})
        rep = r.json()
        rid = rep["id"]
        created_reports.append(rid)
        # newly uploaded becomes active
        active = requests.get(f"{API}/pdi/dispatch/{TARGET_DISPATCH_ID}/reports",
                              headers=admin_headers).json()["active_id"]
        assert active == rid

        rd = requests.delete(f"{API}/pdi/reports/{rid}", headers=admin_headers)
        assert rd.status_code == 200
        created_reports.remove(rid)

        md = requests.get(f"{API}/master-dispatch/{TARGET_DISPATCH_ID}", headers=admin_headers).json()
        # active pdi fields cleared
        assert not md.get("pdi_report_id")
        pdi_docs = [d for d in md.get("documents", []) if d.get("type") == "PDI"]
        assert len(pdi_docs) == 0


class TestReportsListRegression:
    def test_reports_list_has_source_field(self, admin_headers):
        r = requests.get(f"{API}/pdi/reports?limit=10", headers=admin_headers)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items
        for it in items:
            assert "source" in it
            assert it["source"] in ("ai", "manual")
