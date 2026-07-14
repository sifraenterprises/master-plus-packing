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

## Implemented — Iteration 8 (June 2026): E-Way Bill number format XXXX XXXX XXXX
- Storage normalized to 12 digits (OCR build_record + MasterDispatchInput validator); display/input formatted "XXXX XXXX XXXX" (formatEway in MDForm, used in MD form/view + E-Way table/dialog); portal fill uses grouped format (format_eway in eway_routes); dry-run sample updated. TEST validation still 11/11.

## Implemented — Iteration 9 (June 2026): Real portal layout adjustments (from user's screenshot)
- Real TAFE E-Way Bill Entry page revealed: Company Code is static text (TMTL, not an input), validity dates are calendar inputs. Engine now skips fill for read-only Company Code (verify-only), fill_date() falls back to JS value-set for calendar widgets; dry-run fill marks read-only fields OK
- portal_selectors.json eway section updated to resilient attribute-based selectors ([id*='EwayBill' i] etc.) — still editable in-app after live validation on VPS
- UI: From/To Validity are now inline date pickers directly in the E-Way table (auto-save per change), edit dialog uses date pickers, "E-way Bill Number Format — XXXX XXXX XXXX" note added like the portal
- Data hygiene: deleting a master_dispatch record now cascades its eway_submission; cleaned 6 orphaned submissions; stats accurate

## Implemented — Iteration 10 (June 2026): Vendor E-Way Bill Acknowledgement module
- New sidebar group "Automation" (ASN Creation placeholder, E-Way Bill Entry, Vendor E-Way Bill Ack.); NavGroup generalized
- Master Dispatch extended (additive): asn_number + plant fields (OCR prompt extracts both best-effort; MDForm has ASN input + Plant dropdown); plants master collection (configurable, seeded: "TMTL - Production - Bhopal-700", "TAFE MOTORS AND TRACTORS LTD.-7075") with GET/POST /api/master-dispatch/plants (POST admin-only)
- New /api/vendor-ack/* (routes/vendor_ack_routes.py) + vendor_eway_acknowledgement collection (dispatch_id unique): records join, stats, run (single record, editable company/transporter/plant, read-only ASN from MD), retry (blocked for Completed), run-status, logs, screenshots serving
- VendorAckAutomation class in shared automation.py: select_by_label (exact text + verify, never index), intelligent waits (no fixed delays live), full flow menu→dropdowns→ASN→Search→grid wait→checkbox→screenshot→Submit→success detect. TEST triggers: NOTFOUND→Pending "ASN Details Not Found" (retryable), ACKED→Completed "Already Acknowledged" (no retry), ERR→Retry Scheduled after 3 auto-retries, BADDROP→Failed "Dropdown Value Not Found". Screenshots before_submit/after_success/after_failure; execution_log per ack + automation_logs; execution_time_ms; vendor_ack_status synced onto master_dispatch record
- Frontend /portal/modules/vendor-ack: stats, Acknowledgement Panel (record select auto-fills, Start Automation), grid (status colors, ack date, portal message, View Screenshot/View Log/Retry actions)
- Testing iteration_7: backend 23/23, frontend 100%, regressions all pass; test data cleaned after run

## Implemented — Iteration 11 (June 2026): Transporters master dropdown
- New configurable transporters collection seeded with portal values: MAHALAKSHMI LOGISTICS PVT.LTD. - 331430, MAHALAKSHMI LOGISTICS PVT LTD - 337310, OM LOGISTICS SUPPLY CHAIN PVT - 339579, SAMPARK INDIA LOGISTICS PRIVAT - 334540, SUNTEK AXPRESS INDIA LIMITED - 339532
- GET/POST /api/master-dispatch/transporters (POST admin-only); MDForm Transporter Name is now a dropdown (keeps OCR value as extra option, confidence badge preserved); Vendor Ack panel Transporter is a dropdown too

## Implemented — Iteration 12 (June 2026): ASN Creation Automation module (Phase 1 + 2)
- New /api/asn/* (routes/asn_routes.py) + asn_creation collection (master_dispatch_id unique): import from MD (only dispatches with empty asn_number, idempotent), records (filter/search/pagination), edit (manual PO Number override — synced back to master_dispatch, transporter, amounts, Field(ge=0)), PDI PDF upload (validated %PDF, gates Draft→Ready), run/run-ready/retry-failed queue (one ASN at a time, max 3 auto-retries), run-status, stats, xlsx export, screenshot serving
- ASNAutomation class in automation.py implements exact TAFE sequence: Login → Create ASN → select PO (exact text) → Search → per dispatched part "Click here to Add to Invoice" + ASN Qty → fill Invoice No/Date/Basic/Total (+cgst/sgst/igst/cases optional) → Transporter (exact visible text) → attach PDI → wait upload → Create ASN → capture generated ASN Number. On success: asn_number saved on record + linked master_dispatch (status ready_for_eway). Failure: error_message + after_failure screenshot + page HTML dump + retry. TEST triggers: NOPO→DropdownMatchError, ERR→AutomationError
- Fixed invalid mixed-engine Playwright selectors (attach_success, no_details_indicator now CSS :text()); removed dead duplicate ASNAutomation stub
- Frontend /portal/modules/asn (AsnModule.jsx): stats tiles, Import From MD, Start Automation, Retry Failed, Export Excel, status filter + search, per-row Edit (manual PO)/Attach PDI/Run/View Log, live queue progress bar, log dialog
- Phase 2 confirmed done: MD OCR (md_ocr.py) extracts po_number, asn_number, plant during invoice upload; shown on verification form; import skips MDs that already have an ASN
- Testing iteration_8: backend 8/8, frontend 100%, regressions (MD, E-Way, Vendor Ack) pass; test seed data cleaned

## Implemented — Iteration 13 (June 2026): Daily Dispatch Report (Master Dispatch)
- New menu Master Dispatch → Daily Dispatch Report (/portal/master-dispatch/daily-report, DailyDispatchReport.jsx)
- Filters: Dispatch Date (mandatory, matches invoice_date), Customer (optional), Company/Plant (optional) — dropdowns fed by GET /api/master-dispatch/daily-report/options (distinct values)
- APIs (registered before /{record_id} to avoid shadowing): GET daily-report (rows Sr/Invoice/Qty/BOX + total_boxes, invalid date→400), daily-report/pdf (reportlab A4 portrait, black-bordered register layout, repeat header), daily-report/excel (openpyxl, Calibri 11, thin borders, merged header, Total row)
- On-screen report: white paper-style A4 preview matching the physical dispatch register (GREWAL ENGINEERING WORKS / DAILY DISPATCH SUMMARY / DATE :- DD-MM-YYYY / SR.NO|INVOICE NUMBER|QTY|UNIT / Total :- XX BOX)
- Print button: @media print CSS — A4 portrait, hides sidebar/nav/buttons/scrollbars, shows only report, thead repeats per page (table-header-group), Arial 11pt, B/W
- Self-tested: API rows/totals/filters, PDF text content, Excel structure, frontend generate + render (5 rows, total 23); seed data cleaned

## Implemented — Iteration 14 (June 2026): ERP Reporting Dashboard (Reports page rebuild)
- /portal/reports rebuilt (Reports.jsx + components/reports/*): 13 clickable KPI cards (today/month dispatches+boxes, pending/completed per module), Quick Reports row (Daily Dispatch Summary date dialog → daily-report page auto-generate via ?date=, Invoice Register, pending presets, Customer/Plant/Transporter/Monthly group dialogs w/ search+CSV), expandable Advanced Search (16 text/date filters + 5 status dropdowns, Search/Reset/Save Filter/Excel/PDF/CSV/Print)
- Report table: invoice-centric rows joining master_dispatch↔packing_slips(invoice_number)↔asn_creation(master_dispatch_id)↔eway_submissions(record_id)↔vendor_eway_acknowledgement(dispatch_id); colored status badges (green/amber/red), server-side pagination+sorting, sticky headers, drag-resizable columns, column visibility selector, row click → workflow drill-down dialog (MD→Packing→ASN→E-Way→VendorAck→DQMS with timestamps/doc numbers/PDF download)
- Charts (recharts): dispatches by month/customer/plant/transporter, boxes per day (30d), ASN/E-Way/VendorAck completion donuts
- Backend /api/reports/*: erp (aggregation pipeline w/ $lookups + computed statuses), kpis, charts, group, erp/export (excel/pdf/csv w/ columns param), workflow/{id}; indexes added (invoice_date, plant, transporter_name, packing_slips.invoice_number). Old /reports/summary untouched
- Saved Report Views: report_views collection — admin can save SHARED templates, dispatch personal only (403 enforced); per-user default view (report_view_prefs) auto-applied on page load; apply/set-default/delete from dropdown; exports use saved layout (visible columns)
- Testing iteration_9: backend 28/28, frontend 100%, regressions pass

## Implemented — Iteration 15 (June 2026): ASN Manual Batch Allocation
- Automation pauses mid-run when a part shows the portal's "Batch Details" section: reads batch rows (Batch No/Batch Qty/Available Qty), publishes via run-status.awaiting_allocation, waits (asyncio.Event, 15-min timeout) for user confirmation, then fills "Quantity To be Confirmed" + Batch Considerable Yes/No per row and continues (live selectors: batch_container/batch_rows/batch_qty_input/batch_radio in portal_selectors.json)
- BatchAllocationDialog (components/asn/): read-only Batch No/Batch Qty/Available Qty, editable Allocate Qty, Consider toggle, ASN Qty/Total Allocated/Remaining tiles, Auto Allocate/Clear/Confirm/Cancel; single-batch auto-fill; "ASN Quantity exceeds Available Batch Quantity." banner; per-row "Allocation cannot exceed Available Quantity."; Confirm disabled until Remaining=0
- Endpoints: POST /api/asn/allocation/confirm (server validates over-allocation + total==ASN qty), /allocation/cancel (→ record Failed, no retry via BatchAllocationError), GET /api/asn/batch-allocations (report); record status "Awaiting Allocation"; allocations reused automatically on retries
- Persistence: asn_batch_allocations collection (asn_number, dispatch_id, part, batch, qtys, considerable, created_by/at; indexed); shown in ASN Register excel ("Batch Allocations" column), Batch Allocation Report dialog (search+CSV) on ASN page, and Reports workflow drill-down (batches under ASN step)
- TEST simulation: parts containing BATCH (LOW→insufficient single batch, MULTI→3 batches split) trigger the flow; non-BATCH parts unchanged
- Fixed: critical dialog state-reset bug (poll re-created req object wiping inputs); VendorAck option hydration warning
- Testing iteration_10: backend 16/16; frontend re-verified after fix (manual 15+20+5 split across 3 batches → Completed with ASN, values survive polling)

## Backlog
- P0: none outstanding
- P1: PATCH semantics for partial updates; factory images/certificates upload for company profile (needs object storage integration); "Masters" section in Settings (admin UI to add/remove Plants & Transporters); DQMS Automation module; split automation.py into automation/ package (eway.py, asn.py, vendor_ack.py); VPS go-live checklist (playwright install chromium --with-deps, Validate Portal, TAFE IP whitelist)
- P2: barcode/QR generation, email/WhatsApp/SMS notifications, SAP/ERP integrations, per-user password change UI, dashboard charts (recharts)

## Test Credentials
See /app/memory/test_credentials.md (admin/5@Sohangso, dispatch/5@Grewal)
