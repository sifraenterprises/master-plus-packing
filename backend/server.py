from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
from logging.handlers import RotatingFileHandler
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from database import db, client
from models import utcnow
from auth import hash_password, verify_password
from routes.auth_routes import router as auth_router
from routes.dispatch_routes import router as dispatch_router
from routes.modules_routes import router as modules_router, seed_modules
from routes.reports_routes import router as reports_router
from routes.packing_routes import router as packing_router
from routes.admin_routes import router as admin_router, public_router
from routes.master_dispatch_routes import router as master_dispatch_router
from routes.eway_routes import router as eway_router
from routes.vendor_ack_routes import router as vendor_ack_router
from routes.asn_routes import router as asn_router
from routes.system_routes import router as system_router
from routes.environment_routes import router as environment_router
from routes.pdi_routes import router as pdi_router
from routes.documents_routes import router as documents_router, seed_document_types
from routes.worker_routes import router as worker_router

REQUIRED_ENV = ["MONGO_URL", "DB_NAME", "JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD",
                "DISPATCH_USERNAME", "DISPATCH_PASSWORD"]
_missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
if _missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(_missing)} "
                       f"(see backend/.env.example)")

_version_file = ROOT_DIR.parent / "VERSION"
APP_VERSION = _version_file.read_text().strip() if _version_file.exists() else "1.0"


def _log_handlers():
    handlers = [logging.StreamHandler()]
    for candidate in (Path(os.environ.get("LOG_DIR", "/var/log/grewal")), ROOT_DIR / "logs"):
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            app_h = RotatingFileHandler(candidate / "api.log", maxBytes=10 * 1024 * 1024, backupCount=5)
            err_h = RotatingFileHandler(candidate / "error.log", maxBytes=10 * 1024 * 1024, backupCount=5)
            err_h.setLevel(logging.ERROR)
            handlers += [app_h, err_h]
            break
        except OSError:
            continue
    return handlers


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                    handlers=_log_handlers())
logger = logging.getLogger(__name__)

app = FastAPI(title="Grewal Engineering Works — Automation Portal", version=APP_VERSION)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


@app.get("/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}


api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Grewal Engineering Works API", "status": "online", "version": APP_VERSION}


@api_router.get("/health")
async def api_health():
    return {"status": "ok", "version": APP_VERSION}


api_router.include_router(auth_router)
api_router.include_router(dispatch_router)
api_router.include_router(modules_router)
api_router.include_router(reports_router)
api_router.include_router(packing_router)
api_router.include_router(admin_router)
api_router.include_router(master_dispatch_router)
api_router.include_router(eway_router)
api_router.include_router(vendor_ack_router)
api_router.include_router(asn_router)
api_router.include_router(system_router)
api_router.include_router(environment_router)
api_router.include_router(pdi_router)
api_router.include_router(documents_router)
api_router.include_router(public_router)
api_router.include_router(worker_router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def seed_user(username_env: str, password_env: str, name: str, role: str):
    username = os.environ[username_env].strip().lower()
    password = os.environ[password_env]
    existing = await db.users.find_one({"username": username})
    if existing is None:
        await db.users.insert_one({
            "username": username, "name": name, "role": role,
            "password_hash": hash_password(password), "created_at": utcnow().isoformat(),
        })
        logger.info(f"Seeded user: {username} ({role})")
    elif not verify_password(password, existing.get("password_hash", "")):
        await db.users.update_one({"username": username}, {"$set": {"password_hash": hash_password(password)}})
        logger.info(f"Updated password for seeded user: {username}")


@app.on_event("startup")
async def startup():
    await db.automation_jobs.create_index([("status", 1), ("created_at", 1)])
    await db.automation_jobs.create_index("job_type")
    await db.automation_jobs.create_index("worker_name")
    await db.automation_workers.create_index("worker_name", unique=True)
    await db.automation_workers.create_index([("last_heartbeat", -1)])
    await db.users.create_index("username", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.dispatch_entries.create_index("dispatch_id")
    await db.dispatch_entries.create_index("invoice_number")
    await db.activity_logs.create_index("timestamp")
    await db.master_dispatch.create_index("dispatch_no", unique=True)
    await db.master_dispatch.create_index("invoice_number")
    await db.master_dispatch.create_index("customer_name")
    await db.master_dispatch.create_index("status")
    await db.master_dispatch.create_index("batch_id")
    await db.master_dispatch.create_index([("created_at", -1)])
    await db.master_dispatch.create_index("invoice_date")
    await db.master_dispatch.create_index("plant")
    await db.master_dispatch.create_index("transporter_name")
    await db.packing_slips.create_index("invoice_number")
    await db.report_views.create_index("owner")
    await db.report_view_prefs.create_index("username", unique=True)
    await db.md_batches.create_index("batch_id", unique=True)
    await db.md_uploaded_invoices.create_index("file_id", unique=True)
    await db.md_uploaded_invoices.create_index("batch_id")
    await db.md_ocr_logs.create_index("batch_id")
    await db.md_ocr_logs.create_index([("created_at", -1)])
    await db.eway_submissions.create_index("record_id", unique=True)
    await db.eway_submissions.create_index("status")
    await db.vendor_eway_acknowledgement.create_index("dispatch_id", unique=True)
    await db.vendor_eway_acknowledgement.create_index("status")
    # Environment (test/live/maintenance) — safe repeatable migration
    for coll in ("master_dispatch", "packing_slips", "pdi_reports", "asn_creation",
                 "eway_submissions", "vendor_eway_acknowledgement"):
        await db[coll].create_index("environment")
        await db[coll].update_many(
            {"environment": {"$exists": False}},
            {"$set": {"environment": "live", "is_test": False, "created_environment": "live"}})
    await db.environment_audit.create_index([("created_at", -1)])
    await db.vendor_eway_acknowledgement.create_index([("created_at", -1)])
    await db.plants.create_index("name", unique=True)
    await db.asn_creation.create_index("master_dispatch_id", unique=True)
    await db.asn_creation.create_index("status")
    await db.asn_creation.create_index([("created_at", -1)])
    await db.asn_batch_allocations.create_index("asn_record_id")
    await db.asn_batch_allocations.create_index("dispatch_id")
    await db.asn_batch_allocations.create_index("asn_number")
    await db.transporters.create_index("name", unique=True)
    await db.automation_logs.create_index([("timestamp", -1)])
    await db.pdi_master_library.create_index("page_number", unique=True)
    await db.pdi_master_library.create_index("item_code")
    await db.pdi_master_library.create_index("part_name")
    await db.pdi_master_library.create_index("drg_no")
    await db.pdi_master_library.create_index("status")
    await db.pdi_reports.create_index("report_no")
    await db.pdi_reports.create_index("invoice_number")
    await db.pdi_reports.create_index("item_code")
    await db.pdi_reports.create_index([("created_at", -1)])
    await db.pdi_inspectors.create_index("name", unique=True)
    await db.pdi_approvers.create_index("name", unique=True)
    await db.pdi_uploads.create_index("upload_id", unique=True)
    await db.pdi_template_revisions.create_index([("template_id", 1), ("revision", -1)])
    await seed_document_types()
    await seed_user("ADMIN_USERNAME", "ADMIN_PASSWORD", "Administrator", "admin")
    await seed_user("DISPATCH_USERNAME", "DISPATCH_PASSWORD", "Dispatch Operator", "dispatch")
    await seed_modules()
    if os.environ.get("ALERTS_ENABLED", "true").lower() != "false":
        from routes.system_routes import alerts_watchdog
        import asyncio
        asyncio.create_task(alerts_watchdog())
        logger.info("Alerts watchdog started")
    logger.info("Startup complete: users seeded, modules seeded, indexes created")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
