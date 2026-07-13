from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Grewal Engineering Work — Automation Portal")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Grewal Engineering Work API", "status": "online"}


api_router.include_router(auth_router)
api_router.include_router(dispatch_router)
api_router.include_router(modules_router)
api_router.include_router(reports_router)
api_router.include_router(packing_router)
api_router.include_router(admin_router)
api_router.include_router(master_dispatch_router)
api_router.include_router(eway_router)
api_router.include_router(public_router)
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
    await db.md_batches.create_index("batch_id", unique=True)
    await db.md_uploaded_invoices.create_index("file_id", unique=True)
    await db.md_uploaded_invoices.create_index("batch_id")
    await db.md_ocr_logs.create_index("batch_id")
    await db.md_ocr_logs.create_index([("created_at", -1)])
    await db.eway_submissions.create_index("record_id", unique=True)
    await db.eway_submissions.create_index("status")
    await db.automation_logs.create_index([("timestamp", -1)])
    await seed_user("ADMIN_USERNAME", "ADMIN_PASSWORD", "Administrator", "admin")
    await seed_user("DISPATCH_USERNAME", "DISPATCH_PASSWORD", "Dispatch Operator", "dispatch")
    await seed_modules()
    logger.info("Startup complete: users seeded, modules seeded, indexes created")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
