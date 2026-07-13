from fastapi import APIRouter, HTTPException, Depends
from database import db
from models import ModuleConfig
from auth import get_current_user, log_activity

router = APIRouter(prefix="/modules", tags=["modules"])

SEED_MODULES = [
    {"key": "packing", "name": "Packing Module", "description": "Packing slip studio — generate printable outside slips and inside lot cards from shipment details.", "status": "active", "enabled": True, "icon": "Package"},
    {"key": "asn", "name": "ASN Automation", "description": "Advance Shipping Notice creation and submission automation for customer portals.", "status": "coming_soon", "enabled": False, "icon": "Truck"},
    {"key": "eway-bill", "name": "E-Way Bill Automation", "description": "Uploads E-Way Bill numbers from Master Dispatch invoices to the TAFE Vendor Portal — batch runs, retries, test/live modes.", "status": "active", "enabled": True, "icon": "Receipt"},
    {"key": "vendor-ack", "name": "Vendor Acknowledgement", "description": "Automated vendor acknowledgement processing and confirmation tracking.", "status": "coming_soon", "enabled": False, "icon": "Handshake"},
    {"key": "dqms", "name": "DQMS Automation", "description": "Dispatch Quality Management System automation for quality documentation.", "status": "coming_soon", "enabled": False, "icon": "SealCheck"},
]


async def seed_modules():
    for mod in SEED_MODULES:
        await db.modules.update_one({"key": mod["key"]}, {"$setOnInsert": mod}, upsert=True)
    for mod in SEED_MODULES:
        if mod["key"] in ("packing", "eway-bill"):
            await db.modules.update_one({"key": mod["key"]}, {"$set": mod})


@router.get("")
async def list_modules(user: dict = Depends(get_current_user)):
    docs = await db.modules.find().to_list(50)
    return [ModuleConfig.from_mongo(d).model_dump() for d in docs]


@router.get("/{key}")
async def get_module(key: str, user: dict = Depends(get_current_user)):
    doc = await db.modules.find_one({"key": key})
    if not doc:
        raise HTTPException(status_code=404, detail="Module not found")
    return ModuleConfig.from_mongo(doc).model_dump()


@router.post("/{key}/ping")
async def ping_module(key: str, user: dict = Depends(get_current_user)):
    doc = await db.modules.find_one({"key": key})
    if not doc:
        raise HTTPException(status_code=404, detail="Module not found")
    await db.automation_logs.insert_one({
        "module": key, "action": "integration_ping", "triggered_by": user["username"],
        "result": "integration_ready", "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    })
    await log_activity(user["username"], "module_ping", f"Module: {doc['name']}", "automation")
    return {"module": key, "status": "integration_ready", "message": f"{doc['name']} endpoint is live and ready for integration."}
