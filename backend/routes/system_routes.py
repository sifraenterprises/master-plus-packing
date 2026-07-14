import os
import shutil
import time
import asyncio
import logging
from pathlib import Path
from fastapi import APIRouter, Depends
from database import db, client
from auth import require_admin
from alerts import send_alert, alert_channels

router = APIRouter(prefix="/system", tags=["system"])
STARTED_AT = time.time()
logger = logging.getLogger(__name__)


def _playwright_status():
    candidates = []
    if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        candidates.append(Path(os.environ["PLAYWRIGHT_BROWSERS_PATH"]))
    candidates.append(Path.home() / ".cache" / "ms-playwright")
    for base in candidates:
        if base.exists() and any(p.name.startswith("chromium") for p in base.iterdir()):
            return {"ok": True, "detail": f"Chromium installed ({base})"}
    return {"ok": False, "detail": "Chromium not found - run: playwright install --with-deps chromium"}


def _memory():
    info = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, _, rest = line.partition(":")
        if key in ("MemTotal", "MemAvailable"):
            info[key] = int(rest.strip().split()[0]) * 1024
    total, avail = info.get("MemTotal", 0), info.get("MemAvailable", 0)
    return {"total_gb": round(total / 1e9, 2), "used_gb": round((total - avail) / 1e9, 2),
            "percent": round((total - avail) * 100 / total, 1) if total else 0}


def _last_backup():
    backup_dir = Path(os.environ.get("BACKUP_DIR", "/var/backups/grewal"))
    if not backup_dir.exists():
        return {"ok": False, "detail": "No backups yet", "last": None}
    files = sorted(backup_dir.glob("backup_*.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return {"ok": False, "detail": "No backups yet", "last": None}
    age_h = (time.time() - files[0].stat().st_mtime) / 3600
    return {"ok": age_h < 30, "detail": files[0].name, "last": files[0].stat().st_mtime,
            "age_hours": round(age_h, 1), "count": len(files)}


@router.get("/status")
async def system_status(user: dict = Depends(require_admin)):
    from server import APP_VERSION
    from routes.asn_routes import run_state as asn_run
    from routes.eway_routes import run_state as eway_run

    try:
        await client.admin.command("ping")
        database = {"ok": True, "detail": f"Connected ({os.environ['DB_NAME']})",
                    "dispatches": await db.master_dispatch.count_documents({}),
                    "asn_records": await db.asn_creation.count_documents({}),
                    "eway_submissions": await db.eway_submissions.count_documents({})}
    except Exception as e:
        database = {"ok": False, "detail": str(e)[:120]}

    disk = shutil.disk_usage("/")
    load = os.getloadavg()
    failures = await db.asn_creation.find({"status": "Failed"}, {"invoice_no": 1, "error_message": 1, "updated_at": 1, "_id": 0}) \
        .sort("updated_at", -1).to_list(3)
    failures += await db.eway_submissions.find({"status": "Failed"}, {"invoice_number": 1, "error": 1, "updated_at": 1, "_id": 0}) \
        .sort("updated_at", -1).to_list(3)

    return {
        "version": APP_VERSION,
        "uptime_hours": round((time.time() - STARTED_AT) / 3600, 2),
        "api": {"ok": True, "detail": "Backend online"},
        "database": database,
        "playwright": _playwright_status(),
        "gemini": {"ok": bool(os.environ.get("GEMINI_API_KEY")),
                   "detail": f"Key configured · model {os.environ.get('GEMINI_MODEL', 'gemini-flash-latest')}"
                   if os.environ.get("GEMINI_API_KEY") else "GEMINI_API_KEY not set"},
        "automation": {"mode": os.environ.get("AUTOMATION_MODE", "test"),
                       "headless": os.environ.get("AUTOMATION_HEADLESS", "true"),
                       "asn_queue": {"running": asn_run["running"], "processed": asn_run["processed"], "total": asn_run["total"]},
                       "eway_queue": {"running": eway_run.get("running", False)}},
        "disk": {"total_gb": round(disk.total / 1e9, 1), "used_gb": round(disk.used / 1e9, 1),
                 "percent": round(disk.used * 100 / disk.total, 1)},
        "cpu": {"load_1m": round(load[0], 2), "load_5m": round(load[1], 2), "cores": os.cpu_count()},
        "memory": _memory(),
        "backup": _last_backup(),
        "alerts": {"channels": alert_channels()},
        "recent_failures": failures[:5],
    }


@router.post("/alerts/test")
async def test_alert(user: dict = Depends(require_admin)):
    results = await send_alert("Test alert",
                               f"Triggered by {user['username']} from the System Status panel. "
                               "If you can read this, alerting works.", force=True)
    return {"channels": alert_channels(), "results": results}


async def alerts_watchdog():
    """Periodic production checks: MongoDB, disk, backup freshness, Playwright."""
    interval = int(os.environ.get("ALERT_CHECK_INTERVAL", "1800"))
    disk_threshold = float(os.environ.get("ALERT_DISK_THRESHOLD", "85"))
    while True:
        try:
            if any(alert_channels().values()):
                try:
                    await client.admin.command("ping")
                except Exception as e:
                    await send_alert("MongoDB is DOWN", f"Database ping failed: {str(e)[:200]}")
                disk = shutil.disk_usage("/")
                pct = disk.used * 100 / disk.total
                if pct > disk_threshold:
                    await send_alert("Disk space critical",
                                     f"Disk usage at {pct:.1f}% (threshold {disk_threshold}%). "
                                     f"Free: {round((disk.total - disk.used) / 1e9, 1)} GB.")
                backup = _last_backup()
                if backup["last"] is not None and not backup["ok"]:
                    await send_alert("Backup overdue",
                                     f"Last backup '{backup['detail']}' is {backup['age_hours']}h old (>30h). "
                                     "Check /var/log/grewal/backup.log and the grewal-backup cron.")
                pw = _playwright_status()
                if not pw["ok"]:
                    await send_alert("Playwright unavailable", pw["detail"])
        except Exception as e:
            logger.error("alerts_watchdog iteration failed: %s", e)
        await asyncio.sleep(interval)
