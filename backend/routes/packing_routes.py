from fastapi import APIRouter, HTTPException, Depends
from bson import ObjectId
from database import db
from models import PackingSlip, PackingSlipInput
from auth import get_current_user, log_activity

router = APIRouter(prefix="/packing", tags=["packing"])


@router.post("/slips")
async def create_slip(body: PackingSlipInput, user: dict = Depends(get_current_user)):
    slip = PackingSlip(**body.model_dump(), created_by=user["username"])
    result = await db.packing_slips.insert_one(slip.to_mongo())
    await log_activity(user["username"], "packing_slip_saved", f"Invoice {body.invoice_number} — {body.boxes} boxes", "packing")
    doc = await db.packing_slips.find_one({"_id": result.inserted_id})
    return PackingSlip.from_mongo(doc).model_dump()


@router.get("/slips")
async def list_slips(user: dict = Depends(get_current_user)):
    docs = await db.packing_slips.find().sort("created_at", -1).to_list(100)
    return [PackingSlip.from_mongo(d).model_dump() for d in docs]


@router.delete("/slips/{slip_id}")
async def delete_slip(slip_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(slip_id):
        raise HTTPException(status_code=400, detail="Invalid slip ID")
    doc = await db.packing_slips.find_one_and_delete({"_id": ObjectId(slip_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Slip record not found")
    await log_activity(user["username"], "packing_slip_deleted", doc.get("invoice_number", ""), "packing")
    return {"message": "Slip record deleted"}
