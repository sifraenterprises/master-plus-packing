"""
Master Dispatch module — database migration script.
Creates the new collections' indexes only. Existing collections are NOT touched.
Safe to run multiple times (idempotent). Run from /app/backend:
    python ../scripts/master_dispatch_migration.py
"""
import os
import sys
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")
from motor.motor_asyncio import AsyncIOMotorClient


async def migrate():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
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
    print("Master Dispatch migration complete: indexes created on master_dispatch, md_batches, md_uploaded_invoices, md_ocr_logs")
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
