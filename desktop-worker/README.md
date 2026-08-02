# Grewal Desktop Automation Worker

Runs TAFE portal automation from the office Windows PC while the website/API remain on the Hostinger VPS.

## Safety

Start with `TEST_MODE=true` and `HEADLESS=false`. The worker token must match `DESKTOP_WORKER_TOKEN` in `backend/.env` on the VPS. TAFE credentials remain only in this local `.env`.

## Install

1. Install Python 3.12 and Git for Windows.
2. On the assigned office desktop run `install-worker.bat`.
3. Edit the generated `.env`. Enter the shared worker token and the local TAFE
   credentials. Never copy a completed `.env` to GitHub or email.
4. Deploy the new VPS backend route and add `DESKTOP_WORKER_TOKEN` to `backend/.env`.
5. Run `test-connection.bat`.
6. Run `start-worker.bat`.

The single `GrewalOfficeWorker` profile supports portal validation, ASN creation,
E-Way Bill entry, read-only Print E-Way Bill, and vendor E-Way acknowledgement.
Print E-Way Bill
opens the government portal visibly and waits for the operator to complete
username/password, CAPTCHA, and OTP; the worker never automates or stores them.
Downloaded E-Way Bill PDFs are retained in the worker's `downloads` folder,
or in `EWAY_DOWNLOAD_DIR` when that setting is configured.
Jobs are claimed atomically by the API. Run only one instance of
`start-worker.bat` on the assigned office desktop.

The Admin API can disable an individual registration without deleting it using
`PUT /api/worker/workers/{worker_name}/active` with `{"active": false}`.

## Supported jobs

- `portal_validation`
- `eway_bill_entry`
- `vendor_eway_acknowledgement`
- `asn_creation`
- `print_eway_bill` (manual government-portal login; read-only print/download)

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
