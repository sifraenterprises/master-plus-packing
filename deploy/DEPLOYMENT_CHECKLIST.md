# Deployment Checklist — AI PDI Generator Update (v1.0.0, June 2026)

Compares the current repository against the previously deployed version
(pre-AI-PDI-Generator) and lists everything required to redeploy on the
Hostinger VPS.

---

## ⚠️ Blockers found & FIXED in this repo before deployment

| # | Blocker | Fix applied |
|---|---------|-------------|
| 1 | `requirements.txt` had been overwritten by a full `pip freeze` containing packages that do **not exist on public PyPI** (platform-internal packages not on public PyPI). `pip install -r requirements.txt` would have **failed on the VPS**. | Restored the curated production list + added `pymupdf==1.28.0`. |
| 2 | PDI template revisions store **absolute paths** (`/app/backend/uploads/...`) that do not exist on the VPS — PDI generation would 404 after deploy. | Added `resolve_source_pdf()` in `pdi_generate.py`; all readers now re-anchor paths to the local `backend/uploads/` dir. Portable across any install path. |
| 3 | The PDI template library (121 parts, 128 revisions, inspectors, approvers) lives **only in this environment's MongoDB** — the VPS DB would have an empty PDI library. | Created `deploy/seed/pdi_seed.gz` (57 KB mongodump) + `deploy/seed_pdi.sh` one-time import script. Only touches `pdi_*` master collections; never touches dispatch/invoice/user data. |

---

## 1. Files changed (modified)
- `backend/automation.py` — ASN portal automation now attaches PDI PDFs
- `backend/md_models.py` — PDI doc-type support in Master Dispatch
- `backend/requirements.txt` — added `pymupdf==1.28.0`
- `backend/server.py` — mounts PDI router, seeds document types, removes DQMS
- `backend/routes/asn_routes.py` — PDI auto-upload hooks
- `backend/routes/master_dispatch_routes.py` — PDI doc status tracking
- `backend/routes/modules_routes.py` — DQMS removed, "AI PDI Generator" module seeded
- `backend/routes/reports_routes.py` — PDI KPIs in reporting dashboard
- `frontend/src/App.js`, `PortalLayout.jsx` — PDI routes/navigation
- `frontend/src/pages/AsnModule.jsx`, `Reports.jsx`, `master-dispatch/*` — PDI integration
- `frontend/src/components/md/MDRecordsTable.jsx`, settings panels, report config
- `deploy/backup.sh` — now archives `backend/uploads/` (PDF data safety)
- `deploy/restore.sh` — now restores uploads archive

## 2. Files added
- `backend/pdi_extract.py`, `backend/pdi_generate.py`, `backend/pdi_models.py`
- `backend/routes/pdi_routes.py`, `backend/routes/documents_routes.py`
- `backend/fonts/` — 3 handwriting TTFs (Kalam, PatrickHand, Caveat)
- `backend/uploads/pdi_templates/` — 124 template page PDFs (tracked in git)
- `backend/uploads/pdi_master_template.pdf` — 120-page master
- `backend/tests/test_pdi.py`, `test_pdi_extended.py`, `test_iteration_17_smoke.py`
- `frontend/src/pages/PdiModule.jsx` + `frontend/src/components/pdi/` (8 components)
- `frontend/src/components/md/PdiPanel.jsx`, settings `PeopleMasterList.jsx`, `DocumentTypesPanel.jsx`
- `deploy/seed/pdi_seed.gz` + `deploy/seed_pdi.sh` — PDI library DB seed (one-time)

## 3. Files removed
- All DQMS frontend components/pages and backend DQMS routes (fully deleted).

## 4. Database changes
- **New collections** (auto-created / seeded): `pdi_master_library`, `pdi_template_revisions`,
  `pdi_reports`, `pdi_inspectors`, `pdi_approvers`, `pdi_uploads`, `pdi_import_runs`,
  `document_types`.
- **Modules collection**: `dqms` entry deleted, `pdi` entry inserted — **automatic on
  backend startup** (`seed_modules()`), no manual migration needed.
- **Indexes**: created automatically on startup.
- **One manual step**: run `bash deploy/seed_pdi.sh` once to import the extracted
  121-part PDI template library (see §15).

## 5. Environment variable changes
- **None.** No new keys. Existing `GEMINI_API_KEY`, TAFE credentials, JWT, Mongo vars unchanged.

## 6. Python packages added/removed
- Added: `pymupdf==1.28.0` (PyMuPDF/fitz — PDF rendering)
- Removed: none.

## 7. npm packages added/removed
- **None.** `package.json` is unchanged.

## 8. pip install required?      → **YES** (pymupdf)
## 9. npm install required?      → **NO** (safe to skip; harmless if run)
## 10. npm run build required?   → **YES** (many new/changed React components)
## 11. Backend systemd unit update? → **NO** (same entrypoint, port, workers)
## 12. Nginx config update?      → **NO** (`client_max_body_size 25m` already covers PDF uploads)
## 13. File permissions update?  → **Only if** git pull runs as a different user than the
      service user — re-chown `backend/uploads/` (commands included below).
## 14. New directories needed?   → **NO.** `uploads/pdi_reports/` is auto-created by the app;
      `uploads/pdi_templates/` arrives via git.
## 15. Manual steps after deploy
   1. `bash deploy/seed_pdi.sh` — one-time PDI library import (idempotent, safe to re-run).
   2. Verify PDI module loads with 121 templates (see verification section).

---

## Is `deploy/update.sh` compatible?

**Yes, with conditions.** It is code-compatible with this release (runs pip install,
npm build, restarts `grewal-api`, health-checks `127.0.0.1:8001/health` with automatic
git rollback on failure). But it **assumes**:
1. Python venv at `backend/venv`
2. systemd unit named `grewal-api`
3. nginx serving `frontend/build`
4. The app dir is a git clone of this repo

Since the VPS was deployed manually, **verify those first** (commands below). If all
four hold, `bash deploy/update.sh` is the safest path (it has automatic rollback).
Otherwise use the manual commands. Note: `update.sh` does NOT run the PDI seed —
run `deploy/seed_pdi.sh` manually either way.

---

## Exact VPS commands (manual path)

```bash
# ── 0. SSH in ────────────────────────────────────────────────
ssh YOUR_USER@YOUR_VPS_IP
APP_DIR=/path/to/grewal   # ← set to your actual app directory
cd "$APP_DIR"

# Discover your actual service name / venv (run once):
systemctl list-units --type=service | grep -iE "grewal|uvicorn|fastapi"
ls backend/venv/bin/uvicorn 2>/dev/null || echo "venv is elsewhere — locate it"

# ── 1. Backup BEFORE touching anything ───────────────────────
set -a; source backend/.env; set +a
mkdir -p ~/pre_deploy_backup
mongodump --uri="$MONGO_URL" --db="$DB_NAME" \
  --archive=~/pre_deploy_backup/db_$(date +%Y%m%d_%H%M).gz --gzip
tar -czf ~/pre_deploy_backup/uploads_$(date +%Y%m%d_%H%M).tar.gz -C backend uploads
git rev-parse HEAD > ~/pre_deploy_backup/deployed_commit.txt

# ── 2. Pull latest code ───────────────────────────────────────
git fetch origin
git pull origin main          # (or your branch name)

# ── 3. Python dependencies ────────────────────────────────────
backend/venv/bin/pip install -r backend/requirements.txt

# ── 4. Frontend build ─────────────────────────────────────────
cd frontend
npm install                   # optional (no new packages), but harmless
npm run build
cd ..

# ── 5. One-time: import PDI template library ─────────────────
bash deploy/seed_pdi.sh

# ── 6. Permissions (only if service user ≠ your ssh user) ────
SVC_USER=$(systemctl show grewal-api -p User --value)
sudo chown -R "$SVC_USER": backend/uploads

# ── 7. Restart backend (this is the only moment of downtime, ~2s)
sudo systemctl restart grewal-api

# ── 8. Nginx: no config change needed; reload is free insurance
sudo nginx -t && sudo systemctl reload nginx
```

## Verification (run all)

```bash
# Backend health
curl -fsS http://127.0.0.1:8001/health            # → {"status":"ok","version":"1.0.0"}
curl -fsS http://127.0.0.1:8001/api/health

# Frontend loads
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost/   # → 200

# Database connection + PDI library imported
mongosh --quiet "$MONGO_URL/$DB_NAME" --eval '
  print("templates:", db.pdi_master_library.countDocuments({}));      // 121
  print("revisions:", db.pdi_template_revisions.countDocuments({}));  // 128
  print("modules:", db.modules.countDocuments({key:"pdi"}));          // 1
  print("dqms gone:", db.modules.countDocuments({key:"dqms"}));       // 0
'

# New module end-to-end (replace creds):
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s http://127.0.0.1:8001/api/pdi/templates?limit=1 -H "Authorization: Bearer $TOKEN" | head -c 300
curl -s http://127.0.0.1:8001/api/modules -H "Authorization: Bearer $TOKEN" | grep -o '"AI PDI Generator"'

# Watch logs for 30s while clicking through the UI:
journalctl -u grewal-api -f
```

## Rollback (if anything goes wrong)

```bash
cd "$APP_DIR"
git reset --hard $(cat ~/pre_deploy_backup/deployed_commit.txt)
backend/venv/bin/pip install -r backend/requirements.txt
cd frontend && npm run build && cd ..
mongorestore --uri="$MONGO_URL" --archive=~/pre_deploy_backup/db_*.gz --gzip --drop --nsInclude="$DB_NAME.*"
sudo systemctl restart grewal-api
```

---

## Risk assessment

| Risk | Level | Mitigation |
|------|-------|-----------|
| pip install failure | 🟢 LOW | requirements.txt restored to curated PyPI-only pins; only new wheel is `pymupdf` (prebuilt wheels for Ubuntu). |
| DB corruption | 🟢 LOW | Module/doc-type migration is automatic & idempotent on startup; seed script touches only `pdi_*` masters with `--drop` scoped to those 4 collections. Full pre-deploy backup taken in step 1. |
| Broken template paths | 🟢 LOW (was 🔴) | `resolve_source_pdf()` re-anchors any stored path to the local uploads dir. Tested. |
| Frontend build failure | 🟢 LOW | No package changes; code is lint-clean and built successfully here. |
| Downtime | 🟢 ~2 s | Only the `systemctl restart grewal-api` step; nginx keeps serving the static frontend throughout. |
| TAFE live portal | 🟡 EXISTING | Unrelated to this deploy — VPS IP may need whitelisting by TAFE. Test with AUTOMATION_MODE=test first. |
| Disk usage | 🟢 LOW | Repo grew ~37 MB (template PDFs). backup.sh now archives uploads — watch backup dir growth (7-day retention already in place). |

**Verdict: SAFE TO DEPLOY** after pushing the current repo (with the 3 fixes above) to GitHub via "Save to GitHub".
