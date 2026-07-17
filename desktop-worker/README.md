# Grewal Desktop Automation Worker

Runs TAFE portal automation from the office Windows PC while the website/API remain on the Hostinger VPS.

## Safety

Start with `TEST_MODE=true` and `HEADLESS=false`. The worker token must match `DESKTOP_WORKER_TOKEN` in `backend/.env` on the VPS. TAFE credentials remain only in this local `.env`.

## Install

1. Install Python 3.12 and Git for Windows.
2. Run `install-worker.bat`.
3. Edit `.env`.
4. Deploy the new VPS backend route and add `DESKTOP_WORKER_TOKEN` to `backend/.env`.
5. Run `test-connection.bat`.
6. Run `start-worker.bat`.

## Supported jobs

- `portal_validation`
- `eway_bill_entry`
- `vendor_eway_acknowledgement`
- `asn_creation`

ASN jobs requiring portal batch allocation must include `batch_allocations` in the payload. The first production submission should always be supervised.

## Queue a test job

Use the authenticated admin API `POST /api/worker/jobs`, for example portal validation:

```json
{
  "job_type": "portal_validation",
  "payload": {"attempt_login": true, "dry_run_fill": false},
  "test_mode": true
}
```
