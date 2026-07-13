from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from database import db
from models import LoginRequest, User
from auth import verify_password, create_access_token, get_current_user, log_activity, SESSION_HOURS

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response):
    username = body.username.strip().lower()
    client_ip = request.headers.get("x-forwarded-for", request.client.host or "unknown").split(",")[0].strip()
    identifier = f"{client_ip}:{username}"

    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= MAX_ATTEMPTS:
        locked_at = datetime.fromisoformat(attempt["last_attempt"])
        if datetime.now(timezone.utc) - locked_at < timedelta(minutes=LOCKOUT_MINUTES):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
        await db.login_attempts.delete_one({"identifier": identifier})

    user = await db.users.find_one({"username": username})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await log_activity(username, "login_failed", "Invalid credentials", "auth")
        raise HTTPException(status_code=401, detail="Invalid username or password")

    await db.login_attempts.delete_one({"identifier": identifier})
    token = create_access_token(str(user["_id"]), user["username"], user["role"])
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="lax", max_age=SESSION_HOURS * 3600, path="/",
    )
    await log_activity(username, "login_success", f"Role: {user['role']}", "auth")
    return {"token": token, "user": User.from_mongo(user).model_dump()}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return User.from_mongo(user).model_dump()


@router.post("/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    await log_activity(user["username"], "logout", "", "auth")
    return {"message": "Logged out"}
