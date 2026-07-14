from fastapi import APIRouter, HTTPException, Depends
from bson import ObjectId
from database import db
from models import User, UserCreate, CompanyProfile, utcnow
from auth import require_admin, hash_password, log_activity

router = APIRouter(prefix="/admin", tags=["admin"])
public_router = APIRouter(tags=["public"])


@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    docs = await db.users.find().to_list(100)
    return [User.from_mongo(d).model_dump() for d in docs]


@router.post("/users")
async def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    username = body.username.strip().lower()
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="Username already exists")
    doc = {
        "username": username, "name": body.name.strip(), "role": body.role,
        "password_hash": hash_password(body.password), "created_at": utcnow().isoformat(),
    }
    result = await db.users.insert_one(doc)
    await log_activity(admin["username"], "user_created", f"{username} ({body.role})", "admin")
    created = await db.users.find_one({"_id": result.inserted_id})
    return User.from_mongo(created).model_dump()


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    target = await db.users.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["username"] == admin["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    await db.users.delete_one({"_id": ObjectId(user_id)})
    await log_activity(admin["username"], "user_deleted", target["username"], "admin")
    return {"message": "User deleted"}


@router.get("/logs")
async def activity_logs(limit: int = 200, admin: dict = Depends(require_admin)):
    docs = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(min(limit, 500))
    return docs


@router.get("/company-profile")
async def get_profile(admin: dict = Depends(require_admin)):
    doc = await db.company_profile.find_one({"_id": "profile"}) or {}
    doc.pop("_id", None)
    return CompanyProfile(**doc).model_dump()


@router.put("/company-profile")
async def update_profile(body: CompanyProfile, admin: dict = Depends(require_admin)):
    await db.company_profile.update_one({"_id": "profile"}, {"$set": body.model_dump()}, upsert=True)
    await log_activity(admin["username"], "company_profile_updated", f"published={body.published}", "admin")
    return body.model_dump()


@public_router.get("/company-profile/public")
async def public_profile():
    doc = await db.company_profile.find_one({"_id": "profile"})
    if not doc or not doc.get("published"):
        return {"published": False, "company_name": "Grewal Engineering Works"}
    doc.pop("_id", None)
    return CompanyProfile(**doc).model_dump()
