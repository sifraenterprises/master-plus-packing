"""PDI Template Master Management — backend regression for iteration 19.

Covers: duplicate, restore-revision, bulk activate/deactivate/delete,
bulk-reocr state machine, export/import zip, security (dispatch = 403 on writes,
200 on GET), create-with-duplicate on_duplicate branches (soft — requires an
existing upload_id; skipped if none available).
"""

import io
import os
import time
import json
import zipfile
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert v, "REACT_APP_BACKEND_URL not set"
    return v.rstrip("/")

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"username": "admin", "password": "5@Sohangso"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def dispatch_token():
    r = requests.post(f"{API}/auth/login",
                      json={"username": "dispatch", "password": "5@Grewal"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def disp_h(dispatch_token):
    return {"Authorization": f"Bearer {dispatch_token}"}


@pytest.fixture(scope="session")
def sample_template(admin_h):
    """Pick a template that has pdi_reports (used) so bulk-delete falls back to deactivate."""
    # Try to find a used template via reports list
    r = requests.get(f"{API}/pdi/reports", headers=admin_h, timeout=30)
    assert r.status_code == 200
    reports = r.json().get("items", r.json() if isinstance(r.json(), list) else [])
    used_tid = None
    for rep in reports:
        if rep.get("template_id"):
            used_tid = rep["template_id"]
            break
    # Fallback: pick GUIDE PIN template id from context
    if not used_tid:
        used_tid = "6a57281ebcf851ee45eb6b3c"
    # And grab any active template for duplicate/revision tests
    r = requests.get(f"{API}/pdi/templates", headers=admin_h,
                     params={"page_size": 10}, timeout=30)
    items = r.json().get("items", [])
    assert items, "no templates in library"
    any_tid = items[0]["id"]
    return {"used_tid": used_tid, "any_tid": any_tid, "sample_item": items[0]}


# ---------- security ----------
class TestSecurity:
    def test_dispatch_can_list_templates(self, disp_h):
        r = requests.get(f"{API}/pdi/templates", headers=disp_h, timeout=30)
        assert r.status_code == 200

    def test_dispatch_bulk_forbidden(self, disp_h):
        r = requests.post(f"{API}/pdi/templates/bulk", headers=disp_h,
                          json={"ids": [], "action": "activate"}, timeout=30)
        assert r.status_code == 403

    def test_dispatch_bulk_reocr_forbidden(self, disp_h):
        r = requests.post(f"{API}/pdi/templates/bulk-reocr", headers=disp_h,
                          json={"ids": []}, timeout=30)
        assert r.status_code == 403

    def test_dispatch_export_forbidden(self, disp_h):
        r = requests.get(f"{API}/pdi/templates/export", headers=disp_h, timeout=30)
        assert r.status_code == 403

    def test_dispatch_import_forbidden(self, disp_h):
        files = {"file": ("x.zip", b"PK\x03\x04", "application/zip")}
        r = requests.post(f"{API}/pdi/templates/import", headers=disp_h,
                          files=files, timeout=30)
        assert r.status_code == 403

    def test_dispatch_duplicate_forbidden(self, disp_h, sample_template):
        r = requests.post(
            f"{API}/pdi/templates/{sample_template['any_tid']}/duplicate",
            headers=disp_h, timeout=30)
        assert r.status_code == 403

    def test_dispatch_restore_forbidden(self, disp_h, sample_template):
        r = requests.post(
            f"{API}/pdi/templates/{sample_template['any_tid']}/revisions/1/restore",
            headers=disp_h, timeout=30)
        assert r.status_code == 403


# ---------- list metadata & filter ----------
class TestListMeta:
    def test_list_has_audit_fields(self, admin_h):
        r = requests.get(f"{API}/pdi/templates", headers=admin_h,
                         params={"page_size": 5}, timeout=30)
        assert r.status_code == 200
        items = r.json().get("items", [])
        assert items
        it = items[0]
        # Timestamps must exist; created_by/updated_by may be None for legacy rows
        assert "created_at" in it
        assert "updated_at" in it
        assert "created_by" in it
        assert "updated_by" in it

    def test_status_filter_inactive(self, admin_h):
        r = requests.get(f"{API}/pdi/templates", headers=admin_h,
                         params={"status": "inactive", "page_size": 5}, timeout=30)
        assert r.status_code == 200
        for it in r.json().get("items", []):
            assert it.get("status") == "inactive"


# ---------- duplicate ----------
class TestDuplicate:
    def test_duplicate_creates_copy(self, admin_h, sample_template):
        src_id = sample_template["any_tid"]
        r = requests.post(f"{API}/pdi/templates/{src_id}/duplicate",
                          headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data
        new_id = data["id"]
        # GET to verify
        g = requests.get(f"{API}/pdi/templates/{new_id}",
                         headers=admin_h, timeout=30)
        assert g.status_code == 200
        doc = g.json()
        assert "(Copy)" in doc.get("part_name", "")
        assert doc.get("revision") == 1
        assert doc.get("item_code", "") == ""
        assert doc.get("created_by") == "admin"
        # cleanup — permanent delete (unused)
        requests.delete(f"{API}/pdi/templates/{new_id}",
                        headers=admin_h, timeout=30)


# ---------- restore revision ----------
class TestRestoreRevision:
    def test_restore_bumps_revision(self, admin_h, sample_template):
        src_id = sample_template["any_tid"]
        # Get revisions
        r = requests.get(f"{API}/pdi/templates/{src_id}/revisions",
                         headers=admin_h, timeout=30)
        assert r.status_code == 200
        revs = r.json()
        if not isinstance(revs, list):
            revs = revs.get("items", [])
        if len(revs) < 2:
            pytest.skip(f"Template {src_id} has <2 revisions ({len(revs)})")
        # find an older revision (not the current)
        cur = requests.get(f"{API}/pdi/templates/{src_id}",
                          headers=admin_h, timeout=30).json()
        cur_rev = cur.get("revision", 1)
        older = None
        for rv in revs:
            if rv.get("revision", 0) < cur_rev:
                older = rv["revision"]
                break
        if older is None:
            pytest.skip("no older revision to restore")
        # restore
        r = requests.post(
            f"{API}/pdi/templates/{src_id}/revisions/{older}/restore",
            headers=admin_h, timeout=30)
        assert r.status_code == 200, r.text
        # Verify revision bumped
        after = requests.get(f"{API}/pdi/templates/{src_id}",
                            headers=admin_h, timeout=30).json()
        assert after.get("revision") == cur_rev + 1
        assert after.get("updated_by") == "admin"
        # Old revision snapshot must still exist
        r2 = requests.get(f"{API}/pdi/templates/{src_id}/revisions",
                          headers=admin_h, timeout=30)
        revs2 = r2.json()
        if not isinstance(revs2, list):
            revs2 = revs2.get("items", [])
        assert any(rv.get("revision") == older for rv in revs2)


# ---------- bulk activate/deactivate/delete ----------
class TestBulk:
    def test_bulk_deactivate_then_activate(self, admin_h, sample_template):
        tid = sample_template["any_tid"]
        r = requests.post(f"{API}/pdi/templates/bulk", headers=admin_h,
                          json={"ids": [tid], "action": "deactivate"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("deactivated", 0) >= 1
        # Verify
        g = requests.get(f"{API}/pdi/templates/{tid}", headers=admin_h, timeout=30)
        assert g.json().get("status") == "inactive"
        # activate back
        r = requests.post(f"{API}/pdi/templates/bulk", headers=admin_h,
                          json={"ids": [tid], "action": "activate"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("activated", 0) >= 1
        g = requests.get(f"{API}/pdi/templates/{tid}", headers=admin_h, timeout=30)
        assert g.json().get("status") == "active"

    def test_bulk_delete_used_falls_back_to_deactivate(self, admin_h, sample_template):
        tid = sample_template["used_tid"]
        # ensure it has reports
        r = requests.post(f"{API}/pdi/templates/bulk", headers=admin_h,
                          json={"ids": [tid], "action": "delete"}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        # used -> should be deactivated, not deleted
        assert body.get("deactivated", 0) >= 1
        assert body.get("deleted", 0) == 0
        # cleanup: reactivate
        requests.post(f"{API}/pdi/templates/bulk", headers=admin_h,
                      json={"ids": [tid], "action": "activate"}, timeout=30)

    def test_bulk_delete_unused_permanent(self, admin_h, sample_template):
        # Duplicate first (creates unused copy) then bulk-delete permanently
        src_id = sample_template["any_tid"]
        r = requests.post(f"{API}/pdi/templates/{src_id}/duplicate",
                          headers=admin_h, timeout=30)
        new_id = r.json()["id"]
        r = requests.post(f"{API}/pdi/templates/bulk", headers=admin_h,
                          json={"ids": [new_id], "action": "delete"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted", 0) == 1
        # Verify gone
        g = requests.get(f"{API}/pdi/templates/{new_id}", headers=admin_h, timeout=30)
        assert g.status_code == 404

    def test_bulk_unknown_action(self, admin_h):
        r = requests.post(f"{API}/pdi/templates/bulk", headers=admin_h,
                          json={"ids": [], "action": "purge"}, timeout=30)
        assert r.status_code == 400


# ---------- bulk-reocr state machine ----------
class TestBulkReocr:
    def test_bulk_reocr_empty_ids_400(self, admin_h):
        r = requests.post(f"{API}/pdi/templates/bulk-reocr", headers=admin_h,
                          json={"ids": []}, timeout=30)
        assert r.status_code == 400

    def test_bulk_reocr_state_machine(self, admin_h, sample_template):
        # Ensure not already running
        s = requests.get(f"{API}/pdi/templates/reocr-status",
                        headers=admin_h, timeout=30).json()
        if s.get("running"):
            pytest.skip("reocr already running from another process")
        tid = sample_template["any_tid"]
        r = requests.post(f"{API}/pdi/templates/bulk-reocr", headers=admin_h,
                          json={"ids": [tid]}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "started"
        # Poll status → running true→false with errors (quota exhausted)
        seen_running = False
        for _ in range(60):
            s = requests.get(f"{API}/pdi/templates/reocr-status",
                             headers=admin_h, timeout=30).json()
            if s.get("running"):
                seen_running = True
            elif seen_running or s.get("processed", 0) >= 1:
                break
            time.sleep(5)
        assert s.get("running") is False
        assert s.get("processed", 0) >= 1
        # Errors expected due to Gemini quota exhausted
        assert isinstance(s.get("errors", []), list)


# ---------- export/import ----------
class TestExportImport:
    def test_export_single_id_zip(self, admin_h, sample_template):
        tid = sample_template["any_tid"]
        r = requests.get(f"{API}/pdi/templates/export",
                         headers=admin_h, params={"ids": tid},
                         timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/") or "zip" in r.headers.get("content-type", "")
        # parse zip
        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = z.namelist()
        assert "library.json" in names
        lib = json.loads(z.read("library.json"))
        assert "templates" in lib
        assert len(lib["templates"]) == 1
        # optional: pdfs/ folder
        assert any(n.startswith("pdfs/") for n in names) or len(names) >= 1
        # Save for import test
        pytest.exported_zip = r.content

    def test_export_all_headers(self, admin_h):
        # Only check headers/size, don't parse
        r = requests.get(f"{API}/pdi/templates/export",
                         headers=admin_h, timeout=120, stream=True)
        assert r.status_code == 200
        # Read a chunk to confirm bytes flowing
        first = next(r.iter_content(chunk_size=1024), b"")
        assert first[:2] == b"PK"  # zip magic
        r.close()

    def test_import_merges(self, admin_h):
        blob = getattr(pytest, "exported_zip", None)
        if not blob:
            pytest.skip("no exported zip available")
        files = {"file": ("lib.zip", blob, "application/zip")}
        r = requests.post(f"{API}/pdi/templates/import",
                          headers=admin_h, files=files, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        # existing item_code -> updated (or possibly imported if item_code blank)
        assert (body.get("updated", 0) + body.get("imported", 0)) >= 1
        assert body.get("skipped", 0) >= 0


# ---------- create with on_duplicate — SKIPPED (needs valid upload_id) ----------
class TestCreateOnDuplicate:
    def test_placeholder(self):
        # Upload path is blocked by Gemini quota; per request note, skip this branch.
        pytest.skip("Create-with-on_duplicate requires an OCR upload_id; Gemini quota is exhausted (out of scope).")
