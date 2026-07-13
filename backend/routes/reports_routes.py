from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from database import db
from auth import get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary")
async def summary(user: dict = Depends(get_current_user)):
    total = await db.dispatch_entries.count_documents({})
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    this_month = await db.dispatch_entries.count_documents({"created_at": {"$regex": f"^{month_prefix}"}})
    customers = await db.dispatch_entries.distinct("customer_name")
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$total_value"}}}]
    agg = await db.dispatch_entries.aggregate(pipeline).to_list(1)
    total_value = agg[0]["total"] if agg else 0
    pdfs = await db.uploaded_pdfs.count_documents({})
    return {
        "total_dispatches": total,
        "this_month": this_month,
        "unique_customers": len([c for c in customers if c]),
        "total_value": round(total_value, 2),
        "pdfs_uploaded": pdfs,
    }
