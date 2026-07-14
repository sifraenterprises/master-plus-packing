# Changelog — Grewal Engineering Works Automation Portal

All notable changes to this project are documented here.
Versioning: tag stable releases as `vMAJOR.MINOR.PATCH` (see DEPLOYMENT.md §Versioning).

## v1.0.0 — 2026-06-14

First production-ready release.

### Modules
- **Master Dispatch** — AI OCR invoice ingestion (Gemini), verification screen, bulk upload, search, exports, Daily Dispatch Report (register-style print/PDF/Excel). OCR extracts PO Number, ASN Number and Plant automatically.
- **Dispatch Entry** — legacy invoice PDF extraction and record management.
- **Packing Module** — independent packing slip studio with optional import from Master Dispatch.
- **E-Way Bill Automation** — Playwright submission of E-Way Bill numbers to the TAFE Vendor Portal (batch runs, retries, test/live modes, XXXX XXXX XXXX formatting, validity dates).
- **Vendor E-Way Bill Acknowledgement** — automated portal acknowledgement with plant/transporter selection.
- **ASN Creation Automation** — full portal sequence (PO select → parts → invoice material → PDI attach → Create ASN → capture ASN number) with **Manual Batch Allocation** (pause-and-allocate modal, validation, `asn_batch_allocations` audit trail) and manual PO override.
- **ERP Reports** — KPI dashboard, advanced filters, status-joined report table, quick reports, charts, drill-down workflow, saved report views (admin shared templates), Excel/PDF/CSV/print exports.
- **Settings** — user management, company profile publishing, audit logs.

### Platform
- JWT auth (admin + dispatch roles), brute-force lockout, seeded users from env.
- Production hardening: `/health` endpoint, rotating logs (`/var/log/grewal`), security headers, env validation, configurable CORS.
- Deployment kit under `deploy/` (install.sh, update.sh, systemd unit, nginx config) — see DEPLOYMENT.md.
- Frontend builds cleanly on Node 20 with `npm install && npm run build` (React 18, Router 6, CRA 5).
- Fully branded as Grewal Engineering Works.
