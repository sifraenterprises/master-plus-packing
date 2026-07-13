# Master Dispatch Module — Installation & Rollback Guide

New module added to the Grewal Engineering Works portal. No existing routes, APIs, tables,
auth logic or modules were modified. All new APIs live under `/api/master-dispatch`.

## What was added

### Backend (new files)
- `backend/md_models.py` — Pydantic models (MasterDispatch, MasterDispatchInput, MDItem)
- `backend/md_ocr.py` — Gemini OCR engine, invoice boundary detection, PDF splitting (pypdf), background batch processor
- `backend/routes/master_dispatch_routes.py` — all `/api/master-dispatch/*` REST endpoints

### Backend (minimal edits)
- `backend/server.py` — 3 additions only: router import, `include_router`, index creation on startup
- `backend/requirements.txt` — added `pypdf==6.14.2`
- `backend/.env` — added `GEMINI_API_KEY` (and optional `GEMINI_MODEL`, default `gemini-flash-latest`)

### Frontend (new files)
- `frontend/src/pages/master-dispatch/CreateDispatch.jsx` — upload + verification screen
- `frontend/src/pages/master-dispatch/DispatchList.jsx` — list, filters, sort, pagination, exports, view/edit/delete/duplicate
- `frontend/src/pages/master-dispatch/BulkUpload.jsx` — bulk processing with progress, logs, retry
- `frontend/src/pages/master-dispatch/SearchDispatch.jsx` — advanced search
- `frontend/src/components/md/MDForm.jsx`, `MDRecordsTable.jsx`, `MDStats.jsx`

### Frontend (minimal edits)
- `frontend/src/App.js` — 4 new routes under `/portal/master-dispatch/*`
- `frontend/src/components/PortalLayout.jsx` — new "Master Dispatch" sidebar group with 4 submenus
  (existing single link relabelled "Dispatch Entry", still at `/portal/dispatch`)
- `frontend/src/pages/DashboardHome.jsx` — added Master Dispatch stats strip + module card

## New MongoDB collections (existing collections untouched)
| Collection | Purpose | Indexes |
|---|---|---|
| `master_dispatch` | One record per invoice (items embedded) | dispatch_no (unique), invoice_number, customer_name, status, batch_id, created_at |
| `md_uploaded_invoices` | Original + split PDF file registry | file_id (unique), batch_id |
| `md_batches` | Bulk upload batches with progress + logs | batch_id (unique) |
| `md_ocr_logs` | Raw OCR JSON + errors per invoice | batch_id, created_at |
Also reuses the existing `counters` collection with a new `master_dispatch` key (`GEW-MD-#####`).

## Storage
PDFs stored at `backend/uploads/master_dispatch/` — original files, auto-split per-invoice
files, OCR JSON in `md_ocr_logs`, audit entries in existing `activity_logs` (category `master_dispatch`).

## API summary (`/api/master-dispatch`, JWT protected — Admin & Dispatch)
- `POST /upload` — 1..100 PDFs, background OCR, returns `batch_id`
- `GET /batches`, `GET /batches/{id}`, `POST /batches/{id}/retry` (failed files only)
- `GET /stats` — dashboard counters
- `GET /` — list with search/filters/sort/server-side pagination
- `POST /` — manual create; `GET/PUT /{id}`; `DELETE /{id}` (**admin only**); `POST /{id}/duplicate`
- `GET /export/excel`, `GET /export/pdf`, `GET /files/{file_id}` (stored PDF)

## Environment variable changes
```
GEMINI_API_KEY=<your Google Gemini API key>       # required (backend/.env)
GEMINI_MODEL=gemini-flash-latest                   # optional override
```

## Installation on Hostinger VPS
1. Pull/merge this code into the existing project directory.
2. `cd backend && pip install pypdf==6.14.2` (google-genai is already in requirements)
3. Add `GEMINI_API_KEY=...` to `backend/.env`
4. Optional: run `python ../scripts/master_dispatch_migration.py` (indexes also auto-create on startup)
5. `cd ../frontend && yarn install && yarn build` (no new npm packages required)
6. Restart backend service (supervisor/systemd/pm2). Existing modules keep working — no schema changes.

## Rollback
1. Remove: `backend/md_models.py`, `backend/md_ocr.py`, `backend/routes/master_dispatch_routes.py`,
   `frontend/src/pages/master-dispatch/`, `frontend/src/components/md/`
2. Revert the 3 small edits in `server.py`, the routes/imports in `App.js`,
   the sidebar group in `PortalLayout.jsx`, and the stats/card in `DashboardHome.jsx`.
3. Optionally drop collections: `master_dispatch`, `md_batches`, `md_uploaded_invoices`, `md_ocr_logs`
   and delete `backend/uploads/master_dispatch/`. No other data is affected.
4. Remove `GEMINI_API_KEY` from `.env`. Restart services.

## Notes / limits
- OCR model: Google Gemini (`gemini-flash-latest`) via the customer's own API key.
- PDFs larger than 25 pages are processed in 25-page chunks (an invoice spanning a chunk boundary may split imperfectly — edit in verification screen).
- Confidence below 90% is highlighted amber on the verification screen and stored in `low_confidence_fields`.
- Designed as the central data source for Packing, ASN, E-Way Bill, Vendor Ack, DQMS and Reports (records carry status: pending → ready_for_asn / ready_for_eway → completed).

---

# E-Way Bill Automation Module (merged from eway-bill-submit project)

Merged into the same application at `/portal/modules/eway-bill`. Reuses the shared TAFE portal
automation engine (`backend/automation.py`, Playwright-based, engine classes also ready for future
ASN / Vendor Ack / DQMS / Packing Slip portal automation).

## What it does
Uploads E-Way Bill numbers from Master Dispatch invoices to the TAFE Vendor Portal
(E-Way Bill → E-Way Bill Entry): batch runs, per-record runs, retry failed, max 3 attempts per
record, failure screenshots, TEST/LIVE modes with admin-gated LIVE switch that requires both a
non-destructive portal selector validation and a full TEST workflow validation to pass first.

## Data flow (single source of truth)
- Records come directly from `master_dispatch` (E-Way Bill number extracted by OCR).
- Per-record portal details (company code, from/to validity DD/MM/YYYY) are stored in a new
  `eway_submissions` collection keyed by master_dispatch id — the Master Dispatch schema is untouched.
- On successful portal submission the Master Dispatch record status is set to `completed`.

## New backend files
- `backend/automation.py` + `backend/portal_selectors.json` (copied verbatim from eway-bill-submit — shared engine)
- `backend/routes/eway_routes.py` — all `/api/eway/*` endpoints (existing auth middleware, admin-only mode/selector changes)
- `backend/screenshots/` — failure screenshots
- New collections: `eway_submissions`, plus reuse of `automation_logs` and `settings`

## New frontend files
- `frontend/src/pages/EWayBillModule.jsx` (tabs: E-Way Entry + admin Selector Config & Validation)
- `frontend/src/components/eway/EwayEntryTab.jsx`, `SelectorConfigTab.jsx`

## API summary (`/api/eway`, JWT protected)
- `GET /records` (status/invoice/dispatch/date filters + pagination), `PUT /records/{id}` (company code + validity)
- `GET /stats`, `POST /run`, `POST /run-all-pending`, `POST /retry-failed`, `GET /run-status`, `GET /logs`
- `GET /export` (Excel), `GET /screenshots/{name}`
- `GET /settings`, `POST /settings/mode` (admin, LIVE gated by validations)
- `GET/PUT /selectors` (PUT admin), `POST /portal/validate` (admin), `GET /validation/status`, `POST /validation/test-run` (admin)

## Environment variables (backend/.env)
```
AUTOMATION_MODE=test            # test | live (also switchable in UI by admin)
AUTOMATION_HEADLESS=true
TAFE_PORTAL_URL=                # set real values on the VPS before going LIVE
TAFE_USERNAME=
TAFE_PASSWORD=
```

## VPS installation additions
1. `pip install playwright && playwright install chromium --with-deps` (needed only for LIVE mode / portal validation)
2. Fill the TAFE_* env values, restart backend.
3. In the module (admin): Selector Config tab → Validate Portal (with login) → Run TEST Validation → switch to LIVE.

## Rollback (E-Way module only)
Remove `backend/routes/eway_routes.py`, `backend/automation.py`, `backend/portal_selectors.json`,
`frontend/src/pages/EWayBillModule.jsx`, `frontend/src/components/eway/`; revert the 2 server.py edits,
the route in App.js and the eway-bill entry in modules_routes.py; optionally drop `eway_submissions`.
