# PRD — Grewal Engineering Work Automation Portal

## Original Problem Statement
Secure, modular web portal for Grewal Engineering Work that becomes the company's internal automation platform. Under-construction landing page, secure 2-user login (admin/dispatch), role-based dashboards, Master Dispatch Entry with AI invoice PDF extraction, placeholder automation modules (Packing, ASN, E-Way Bill, Vendor Ack, DQMS), reports with exports, company profile management, RBAC, audit logs.

## User Choices
- AI-powered OCR (Emergent Universal Key → Gemini gemini-2.5-flash PDF extraction)
- JWT custom auth, seeded users: admin/5@Sohangso, dispatch/5@Grewal
- Dark industrial theme (steel dark + safety orange, Chivo/IBM Plex Sans)
- Stack: React + FastAPI + MongoDB (user approved swap from Node/PostgreSQL)

## Architecture
- Backend `/app/backend`: server.py (app + seeding), database.py, models.py (PyObjectId/BaseDocument), auth.py (bcrypt, JWT 8h, RBAC, activity logging), routes/ package: auth_routes, dispatch_routes (extract/CRUD/exports), modules_routes (pluggable module registry), reports_routes, admin_routes (users/profile/logs + public profile endpoint)
- Frontend `/app/frontend/src`: pages (Landing, Login, DashboardHome, MasterDispatch, Reports, Settings, ModulePlaceholder), components (PortalLayout sidebar, DispatchEntryForm shared), context/AuthContext, lib/api (axios Bearer interceptor)
- DB collections: users, dispatch_entries, uploaded_pdfs, activity_logs, automation_logs, modules, company_profile, login_attempts, counters
- Modules are DB-registered (key/name/status/enabled) → new modules plug in with own routes/collections, dashboard renders them dynamically

## Implemented (June 2026 — MVP)
- Under Construction landing page (industrial bg, contact, footer) that auto-switches to published company profile
- JWT login (username-based), brute-force lockout (5 fails → 15 min, X-Forwarded-For aware), 8h session timeout, RBAC (403 on admin routes for dispatch role)
- Role-based dashboards: admin (8 cards incl. Settings), dispatch (7 cards)
- Master Dispatch Entry: PDF upload → Gemini AI extraction (multi line-item) → editable review → bulk save with unique IDs (GEW-DSP-#####), manual entry, search/edit/delete, Excel + PDF export
- 5 automation placeholders: Coming Soon + Integration Ready ping (logs to automation_logs)
- Reports: summary stats, filters (invoice/part/customer/date range), exports
- Admin Settings: user CRUD, company profile publish toggle, audit logs viewer
- Testing: iteration_1 — backend 22/23 (lockout fixed + verified after), frontend 11/11 flows

## Implemented — Iteration 2 (June 2026)
- Packing Module merged (rebuilt from slip-automation-1 app): Packing Slip Studio at /portal/modules/packing — shipment form, live preview (outside slip + inside lot card), Save/History/Load/Delete, printable outside slips (8/A4) & inside lot cards (16/A4 2×8 strips), backend /api/packing/slips CRUD, module registry set to "active"
- Dispatch records pagination: 25/page — GET /api/dispatch returns {items,total,page,page_size,pages}; Prev/Next controls on Master Dispatch and Reports pages

## Implemented — Iteration 3 (June 2026)
- Full Grewal Engineering Works company website (merged verbatim from grewal-engineering EMT - 57cd4c project via its source bundle) is now the main front page at "/": Navbar (smooth-scroll + Portal Login button), Hero, About, Leadership, Overview, Capabilities, Machinery, Quality, Customers (marquee), Product Gallery (5 tabbed categories with product images), Vision, Footer with real contact details (address, phones, email). Components live in /app/frontend/src/components/landing/. Added react-fast-marquee dependency.
- The old "Under Construction" page is retired. Admin Settings → Company Profile management remains (data stored, no longer drives the landing page).

## Implemented — Iteration 4 (June 2026): Master Dispatch Module
- New sidebar group "Master Dispatch" with 4 submenus: Create Dispatch, Dispatch List, Bulk Upload, Search Dispatch (old module relabelled "Dispatch Entry", untouched at /portal/dispatch and /api/dispatch)
- New APIs under /api/master-dispatch (existing APIs unmodified): upload (1-100 PDFs, background OCR), batches (progress/logs/retry failed only), stats, CRUD, duplicate, admin-only delete, excel/pdf export, stored PDF retrieval
- OCR: customer's own GEMINI_API_KEY (backend/.env, model gemini-flash-latest via google-genai SDK). Multi-invoice PDFs auto-detected + split with pypdf (>25 pages chunked). Per-field confidence 0-100; <90% highlighted amber on verification screen, editable before save
- New collections: master_dispatch (items embedded), md_batches, md_uploaded_invoices (original+split PDFs), md_ocr_logs. IDs GEW-MD-##### via counters. Files at backend/uploads/master_dispatch/
- Frontend: pages/master-dispatch/* + components/md/* (MDForm, MDRecordsTable, MDStats); dashboard shows Master Dispatch stats strip (total/today/pending/ready ASN/ready E-Way/completed/OCR errors)
- Docs: /app/docs/MASTER_DISPATCH_MODULE.md (install/migration/rollback), /app/scripts/master_dispatch_migration.py
- Testing iteration_5: backend 23/23, frontend 38/38 pass incl. regressions on all existing modules

## Implemented — Iteration 5 (June 2026): Packing ↔ Master Dispatch independence
- Confirmed modules are fully decoupled: packing_slips collection + /api/packing vs master_dispatch + /api/master-dispatch; no shared logic, no FKs, no backend changes made
- Added optional "Import from Master Dispatch" button on Packing Slip Studio (frontend-only, components/PackingImportDialog.jsx): searchable picker, copies invoice_number/item name/item code/qty/boxes/customer into a NEW slip once — no live link, later edits never sync; if MD API is down the dialog shows an error toast and Packing keeps working normally

## Implemented — Iteration 6 (June 2026): E-Way Bill Automation merged (from eway-bill-submit project)
- Merged the user's separate eway-bill-submit project into this app (no second application): shared TAFE portal automation engine copied to backend/automation.py + portal_selectors.json (Playwright, engine classes also ready for future ASN/Vendor Ack/DQMS/Packing portal automation)
- New /api/eway/* routes (routes/eway_routes.py) using existing JWT auth: records (from master_dispatch, joined with new eway_submissions collection), PUT details (company code + validity DD/MM/YYYY), run/run-all-pending/retry-failed (max 3 attempts, failure screenshots in backend/screenshots/), stats, logs, export xlsx, run-status, settings mode (admin, LIVE gated by portal validation + TEST workflow validation 11/11 checks), selectors get/put (admin), portal validate, validation test-run
- On successful portal submission the master_dispatch record status auto-syncs to "completed"
- Frontend /portal/modules/eway-bill: EWayBillModule page (tabs E-Way Entry + admin Selector Config & Validation), matches dark industrial theme; module registry eway-bill set to "active"
- Env: AUTOMATION_MODE=test, AUTOMATION_HEADLESS=true, TAFE_PORTAL_URL/USERNAME/PASSWORD (blank — user sets on VPS before LIVE); playwright added to requirements (VPS needs `playwright install chromium`)
- Testing iteration_6: backend 25/25, frontend 100% pass incl. regressions on all modules

## Attempted — Iteration 7 (June 2026): Live TAFE portal validation
- TAFE credentials stored in backend/.env only (TAFE_PORTAL_URL=https://wb01.tafechannel.com/, TAFE_USERNAME, TAFE_PASSWORD) — never logged, never shown in UI/API responses
- Added dry_run_fill option to validate_portal (automation.py) + API + UI checkbox: fills entry form with sample data, verifies each value via input_value, NEVER clicks Submit
- Playwright chromium installed; PLAYWRIGHT_BROWSERS_PATH added to backend/.env for the supervisor-run backend
- RESULT: portal UNREACHABLE from this cloud environment — DNS resolves (103.57.69.174) but all TCP ports filtered while general internet works → TAFE blocks datacenter/non-whitelisted IPs. Validation correctly reports "connect: Portal unreachable"; LIVE mode remains honestly gated (portal validation not marked passed)
- TO DO ON VPS: deploy, `playwright install chromium --with-deps`, click "Validate Portal" (both checkboxes) in Selector Config tab; if VPS is also blocked, ask TAFE to whitelist the VPS IP. Selectors in portal_selectors.json are best-guess and editable in-app once the real page is reachable

## Backlog
- P0: none outstanding
- P1: PATCH semantics for partial updates; factory images/certificates upload for company profile (needs object storage integration)
- P2: barcode/QR generation, email/WhatsApp/SMS notifications, SAP/ERP integrations, per-user password change UI, dashboard charts (recharts)

## Test Credentials
See /app/memory/test_credentials.md (admin/5@Sohangso, dispatch/5@Grewal)
