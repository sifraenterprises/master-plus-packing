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

## Backlog
- P0: none outstanding
- P1: PATCH semantics for partial updates; factory images/certificates upload for company profile (needs object storage integration)
- P2: barcode/QR generation, email/WhatsApp/SMS notifications, SAP/ERP integrations, per-user password change UI, dashboard charts (recharts)

## Test Credentials
See /app/memory/test_credentials.md (admin/5@Sohangso, dispatch/5@Grewal)
