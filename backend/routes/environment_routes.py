from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from database import db
from auth import get_current_user, require_admin, verify_password
from environment import (get_environment, set_environment, run_readiness_checks,
                         env_audit, APP_VERSION, VALID_MODES)

router = APIRouter(prefix="/admin/environment", tags=["environment"])

LIVE_PHRASE = "ACTIVATE LIVE MODE"


class ModeChange(BaseModel):
    mode: str
    reason: str = ""
    password: str = ""
    confirm_phrase: str = ""
    acknowledge: bool = False
    override_warnings: bool = False
    override_reason: str = ""


class StopAction(BaseModel):
    reason: str = ""
    password: str = ""


def _client(request: Request):
    return (request.client.host if request.client else "",
            request.headers.get("user-agent", "")[:200])


async def _check_admin_password(username: str, password: str):
    u = await db.users.find_one({"username": username})
    if not u or not verify_password(password or "", u.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Admin password verification failed")


def _public(env: dict) -> dict:
    return {"mode": env["mode"], "changed_by": env.get("changed_by", ""),
            "changed_at": env.get("changed_at", ""), "reason": env.get("reason", ""),
            "version": env.get("version", 1),
            "live_automation_stopped": bool(env.get("live_automation_stopped", False)),
            "app_version": APP_VERSION}


@router.get("")
async def get_env(user: dict = Depends(get_current_user)):
    return _public(await get_environment())


@router.get("/readiness")
async def readiness(user: dict = Depends(require_admin)):
    result = await run_readiness_checks()
    await env_audit("readiness_check", user["username"], user.get("role", ""),
                    (await get_environment())["mode"], "",
                    extra={"ready": result["ready"], "critical_failures": result["critical_failures"],
                           "warnings": result["warnings"]})
    return result


@router.put("")
async def change_mode(payload: ModeChange, request: Request, user: dict = Depends(require_admin)):
    ip, ua = _client(request)
    if payload.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Use one of: {', '.join(VALID_MODES)}")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required for every mode change")
    prev = await get_environment()
    if payload.mode == prev["mode"]:
        return _public(prev)

    if payload.mode == "live":
        errors = []
        if payload.confirm_phrase.strip() != LIVE_PHRASE:
            errors.append(f'Type the exact phrase "{LIVE_PHRASE}"')
        if not payload.acknowledge:
            errors.append("Confirmation checkbox is required")
        if not payload.password:
            errors.append("Admin password re-entry is required")
        if errors:
            await env_audit("failed_live_activation", user["username"], user.get("role", ""),
                            prev["mode"], "live", payload.reason, ip, ua,
                            extra={"errors": errors})
            raise HTTPException(status_code=400, detail="; ".join(errors))
        await _check_admin_password(user["username"], payload.password)
        readiness_result = await run_readiness_checks()
        if not readiness_result["ready"]:
            fails = [c["name"] for c in readiness_result["checks"] if c["status"] == "FAIL" and c["critical"]]
            await env_audit("failed_live_activation", user["username"], user.get("role", ""),
                            prev["mode"], "live", payload.reason, ip, ua,
                            extra={"critical_failures": fails})
            raise HTTPException(status_code=409,
                                detail=f"LIVE activation blocked — critical readiness failures: {', '.join(fails)}")
        if readiness_result["warnings"] and not payload.override_warnings:
            raise HTTPException(status_code=409, detail={
                "code": "warnings", "warnings": [c for c in readiness_result["checks"] if c["status"] == "WARNING"],
                "message": "Readiness warnings present — confirm override with a reason to proceed."})
        if readiness_result["warnings"] and payload.override_warnings and not payload.override_reason.strip():
            raise HTTPException(status_code=400, detail="Override reason is required to bypass warnings")
        extra = {"readiness": {"ready": True, "warnings": readiness_result["warnings"]},
                 "override_reason": payload.override_reason}
    else:
        extra = {}

    new_env = await set_environment(payload.mode, user["username"], payload.reason.strip())
    await env_audit(f"mode_change_{prev['mode']}_to_{payload.mode}", user["username"],
                    user.get("role", ""), prev["mode"], payload.mode,
                    payload.reason, ip, ua, extra=extra)
    return _public(new_env)


@router.post("/emergency-stop")
async def emergency_stop(payload: StopAction, request: Request, user: dict = Depends(require_admin)):
    ip, ua = _client(request)
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required for emergency stop")
    await _check_admin_password(user["username"], payload.password)
    env = await get_environment()
    await db.system_settings.update_one({"_id": "application_environment"},
                                        {"$set": {"live_automation_stopped": True}}, upsert=True)
    await env_audit("emergency_stop", user["username"], user.get("role", ""),
                    env["mode"], env["mode"], payload.reason, ip, ua)
    return _public(await get_environment())


@router.post("/resume")
async def resume(payload: StopAction, request: Request, user: dict = Depends(require_admin)):
    ip, ua = _client(request)
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="A reason is required to resume live automation")
    await _check_admin_password(user["username"], payload.password)
    env = await get_environment()
    await db.system_settings.update_one({"_id": "application_environment"},
                                        {"$set": {"live_automation_stopped": False}}, upsert=True)
    await env_audit("resume_live_automation", user["username"], user.get("role", ""),
                    env["mode"], env["mode"], payload.reason, ip, ua)
    return _public(await get_environment())


@router.get("/audit")
async def audit_history(limit: int = 50, user: dict = Depends(require_admin)):
    docs = await db.environment_audit.find({}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
    return docs
