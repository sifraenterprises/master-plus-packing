import os
from datetime import datetime, timezone
from pathlib import Path
from fastapi import HTTPException
from database import db

APP_VERSION = "1.1.0"
ENV_DOC_ID = "application_environment"
VALID_MODES = ("test", "live", "maintenance")


def utcnow():
    return datetime.now(timezone.utc)


async def get_environment() -> dict:
    """Source of truth for the application mode. ALWAYS fails safe to TEST."""
    try:
        doc = await db.system_settings.find_one({"_id": ENV_DOC_ID})
        if doc and doc.get("mode") in VALID_MODES:
            return doc
    except Exception:
        pass
    return {"_id": ENV_DOC_ID, "mode": "test", "changed_by": "", "changed_at": "",
            "reason": "default (setting missing or unreadable)", "version": 1,
            "live_automation_stopped": False}


async def set_environment(mode: str, changed_by: str, reason: str, extra: dict = None) -> dict:
    prev = await get_environment()
    doc = {"mode": mode, "changed_by": changed_by, "changed_at": utcnow().isoformat(),
           "reason": reason, "version": prev.get("version", 0) + 1,
           "live_automation_stopped": bool((extra or {}).get("live_automation_stopped",
                                           prev.get("live_automation_stopped", False)))}
    await db.system_settings.update_one({"_id": ENV_DOC_ID}, {"$set": doc}, upsert=True)
    # keep legacy automation_mode setting in sync for older readers
    await db.settings.update_one({"key": "automation_mode"},
                                 {"$set": {"value": "live" if mode == "live" else "test"}}, upsert=True)
    return {**doc, "_id": ENV_DOC_ID}


async def get_effective_automation_mode() -> str:
    """Backend gate used by ALL TAFE portal automation immediately before running.
    Raises when automation must not start. Returns 'test' or 'live'."""
    env = await get_environment()
    if env["mode"] == "maintenance":
        raise HTTPException(status_code=409,
                            detail="MAINTENANCE MODE — new portal automation is blocked")
    if env["mode"] == "live":
        if env.get("live_automation_stopped"):
            raise HTTPException(status_code=409,
                                detail="EMERGENCY STOP is active — live automation is paused by admin")
        return "live"
    return "test"


async def require_live_mode_for_submission():
    """Call immediately before any FINAL external submission. Blocks unless LIVE."""
    mode = await get_effective_automation_mode()
    if mode != "live":
        raise HTTPException(status_code=409, detail={
            "status": "test_completed", "submitted": False, "environment": "test",
            "message": "Validation completed. Final submission was blocked by Test Mode."})
    return mode


async def env_fields() -> dict:
    """Stamp for records created under the current mode (never raises)."""
    try:
        env = await get_environment()
        mode = "live" if env["mode"] == "live" else "test"
    except Exception:
        mode = "test"
    return {"environment": mode, "is_test": mode != "live", "created_environment": mode}


async def env_list_filter() -> dict:
    """LIVE mode hides test records; test/maintenance modes show everything."""
    env = await get_environment()
    if env["mode"] == "live":
        return {"is_test": {"$ne": True}}
    return {}


async def env_upload_dir(base) -> Path:
    """Environment-scoped upload directory: <base>/test or <base>/live."""
    env = await get_environment()
    mode = "live" if env["mode"] == "live" else "test"
    d = Path(base) / mode
    d.mkdir(parents=True, exist_ok=True)
    return d


def find_upload(base, filename: str):
    """Locate a stored file in live/, test/, or legacy root location."""
    for sub in ("live", "test"):
        p = Path(base) / sub / filename
        if p.exists():
            return p
    p = Path(base) / filename
    return p if p.exists() else None


async def env_audit(action: str, username: str, role: str, prev_mode: str, new_mode: str,
                    reason: str = "", ip: str = "", user_agent: str = "",
                    module: str = "environment", record_id: str = "", extra: dict = None):
    await db.environment_audit.insert_one({
        "action": action, "previous_mode": prev_mode, "new_mode": new_mode,
        "username": username, "role": role, "reason": reason,
        "ip": ip, "user_agent": user_agent, "app_version": APP_VERSION,
        "module": module, "record_id": record_id,
        "extra": extra or {}, "created_at": utcnow().isoformat()})


async def run_readiness_checks() -> dict:
    """Live Readiness Check — critical FAILs block LIVE activation."""
    from pathlib import Path
    import shutil
    checks = []

    def add(name, status, detail="", critical=True):
        checks.append({"name": name, "status": status, "detail": detail, "critical": critical})

    try:
        await db.command("ping")
        add("MongoDB connection", "PASS")
    except Exception as e:
        add("MongoDB connection", "FAIL", str(e)[:100])

    missing = [v for v in ("MONGO_URL", "DB_NAME", "JWT_SECRET", "TAFE_PORTAL_URL",
                           "TAFE_USERNAME", "TAFE_PASSWORD", "GEMINI_API_KEY")
               if not os.environ.get(v)]
    add("Required environment variables", "PASS" if not missing else "FAIL",
        f"missing: {', '.join(missing)}" if missing else "")

    live_url = os.environ.get("TAFE_LIVE_PORTAL_URL") or os.environ.get("TAFE_PORTAL_URL", "")
    add("Live TAFE URL is HTTPS", "PASS" if live_url.startswith("https://") else "FAIL", live_url)
    live_user = os.environ.get("TAFE_LIVE_USERNAME") or os.environ.get("TAFE_USERNAME")
    live_pw = os.environ.get("TAFE_LIVE_PASSWORD") or os.environ.get("TAFE_PASSWORD")
    add("Live TAFE credentials configured", "PASS" if (live_user and live_pw) else "FAIL")

    try:
        from routes.pdi_routes import _compute_health
        h = await _compute_health()
        add("No duplicate active PDI item codes",
            "PASS" if h["counts"]["dup_item_code_active"] == 0 else "FAIL",
            f"{h['counts']['dup_item_code_active']} duplicates")
        add("No broken PDI PDF references",
            "PASS" if h["counts"]["broken_pdf"] == 0 else "FAIL",
            f"{h['counts']['broken_pdf']} broken")
        add("PDI library health", "PASS" if h["health_score"] >= 90 else "WARNING",
            f"score {h['health_score']}%", critical=False)
    except Exception as e:
        add("PDI integrity", "FAIL", str(e)[:100])

    uploads = Path(__file__).parent / "uploads"
    add("Upload directory writable", "PASS" if os.access(uploads, os.W_OK) else "FAIL", str(uploads))

    pw_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")
    pw_ok = bool(pw_path and Path(pw_path).exists()) or Path.home().joinpath(".cache/ms-playwright").exists()
    add("Playwright browsers installed", "PASS" if pw_ok else "WARNING",
        pw_path or "~/.cache/ms-playwright", critical=False)

    try:
        free_gb = shutil.disk_usage("/").free / 1e9
        add("Disk space", "PASS" if free_gb > 2 else ("WARNING" if free_gb > 1 else "FAIL"),
            f"{free_gb:.1f} GB free", critical=free_gb <= 1)
    except Exception:
        add("Disk space", "WARNING", "could not determine", critical=False)

    env = await get_environment()
    add("No maintenance lock", "PASS" if env["mode"] != "maintenance" else "FAIL")
    add("Emergency stop not active", "PASS" if not env.get("live_automation_stopped") else "FAIL")

    pv = await db.settings.find_one({"key": "last_portal_validation"})
    add("TAFE portal selector validation", "PASS" if (pv and pv.get("value", {}).get("all_ok")) else "WARNING",
        "run 'Validate Portal' in E-Way selector configuration" if not (pv and pv.get("value", {}).get("all_ok")) else "",
        critical=False)

    critical_fail = any(c["status"] == "FAIL" and c["critical"] for c in checks)
    warnings = sum(1 for c in checks if c["status"] == "WARNING")
    return {"ready": not critical_fail, "critical_failures": sum(1 for c in checks if c["status"] == "FAIL" and c["critical"]),
            "warnings": warnings, "checks": checks, "checked_at": utcnow().isoformat(),
            "app_version": APP_VERSION}
