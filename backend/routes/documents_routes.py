from fastapi import APIRouter, HTTPException, Depends
from database import db
from models import utcnow
from auth import get_current_user, require_admin, log_activity

router = APIRouter(prefix="/documents", tags=["documents"])

DEFAULT_TYPES = [
    {"key": "PDI", "label": "Pre-Dispatch Inspection Report", "required_for_asn": True, "active": True},
    {"key": "MTC", "label": "Material Test Certificate", "required_for_asn": False, "active": False},
    {"key": "HEAT_TREATMENT", "label": "Heat Treatment Report", "required_for_asn": False, "active": False},
    {"key": "PLATING", "label": "Plating / Coating Certificate", "required_for_asn": False, "active": False},
    {"key": "CALIBRATION", "label": "Calibration Certificate", "required_for_asn": False, "active": False},
    {"key": "PPAP", "label": "PPAP Documents", "required_for_asn": False, "active": False},
    {"key": "CUSTOMER_INSPECTION", "label": "Customer-specific Inspection Report", "required_for_asn": False, "active": False},
]


async def seed_document_types():
    for t in DEFAULT_TYPES:
        await db.document_types.update_one({"key": t["key"]}, {"$setOnInsert": t}, upsert=True)


@router.get("/types")
async def list_types(user: dict = Depends(get_current_user)):
    docs = await db.document_types.find({}, {"_id": 0}).sort("key", 1).to_list(100)
    return docs


@router.post("/types")
async def add_type(payload: dict, user: dict = Depends(require_admin)):
    key = str(payload.get("key", "")).strip().upper().replace(" ", "_")
    label = str(payload.get("label", "")).strip()
    if not key or not label:
        raise HTTPException(status_code=400, detail="key and label required")
    existing = await db.document_types.find_one({"key": key})
    if existing:
        raise HTTPException(status_code=409, detail="Document type already exists")
    doc = {"key": key, "label": label, "required_for_asn": bool(payload.get("required_for_asn", False)),
           "active": bool(payload.get("active", True))}
    await db.document_types.insert_one({**doc, "created_at": utcnow().isoformat()})
    await log_activity(user["username"], "document_type_added", key, "documents")
    return doc


@router.put("/types/{key}")
async def edit_type(key: str, payload: dict, user: dict = Depends(require_admin)):
    updates = {}
    for field in ("label",):
        if field in payload and str(payload[field]).strip():
            updates[field] = str(payload[field]).strip()
    for field in ("required_for_asn", "active"):
        if field in payload:
            updates[field] = bool(payload[field])
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = await db.document_types.update_one({"key": key}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Document type not found")
    await log_activity(user["username"], "document_type_edited", key, "documents")
    return {"updated": True}
