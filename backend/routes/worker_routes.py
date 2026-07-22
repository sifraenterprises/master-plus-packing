import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user, require_admin
from database import db
from models import utcnow

router = APIRouter(prefix="/worker", tags=["desktop-worker"])

JOB_TYPES = {"portal_validation", "asn_creation", "eway_bill_entry", "vendor_eway_acknowledgement"}
TERMINAL_STATUSES = {"success", "failed", "cancelled"}


def now_iso() -> str:
    return utcnow().isoformat()



def portal_execution_mode() -> str:
    mode = os.environ.get("PORTAL_EXECUTION_MODE", "local").strip().lower()
    return mode if mode in {"desktop", "local"} else "local"


def desktop_execution_enabled() -> bool:
    return portal_execution_mode() == "desktop"


async def compatible_worker_online(job_type: str = "") -> bool:
    cutoff = utcnow() - timedelta(seconds=90)
    workers = await db.automation_workers.find({"status": "online"}).to_list(50)
    for worker in workers:
        try:
            from datetime import datetime
            heartbeat = datetime.fromisoformat(worker.get("last_heartbeat", ""))
        except Exception:
            continue
        capabilities = set(worker.get("capabilities") or [])
        if heartbeat >= cutoff and (not job_type or job_type in capabilities):
            return True
    return False


async def require_desktop_worker(job_type: str, *, allow_offline_test: bool = False,
                                 test_mode: bool = False) -> None:
    if allow_offline_test and test_mode:
        return
    if not await compatible_worker_online(job_type):
        raise HTTPException(
            status_code=503,
            detail="Desktop Automation Worker is offline. Start OFFICE-PC-01 and retry.",
        )


async def create_automation_job(
    *, job_type: str, payload: dict[str, Any], source_record_id: str,
    created_by: str, test_mode: bool, priority: int = 100,
) -> dict:
    if job_type not in JOB_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported job type: {job_type}")
    timestamp = now_iso()
    doc = {
        "job_id": str(uuid.uuid4()), "job_type": job_type, "status": "pending",
        "payload": payload, "source_record_id": source_record_id,
        "test_mode": bool(test_mode), "priority": priority, "attempts": 0,
        "progress": 0, "message": "Queued", "logs": [], "worker_name": "",
        "created_by": created_by, "created_at": timestamp, "updated_at": timestamp,
    }
    inserted = await db.automation_jobs.insert_one(doc)
    return serialize(await db.automation_jobs.find_one({"_id": inserted.inserted_id}))


def serialize(doc: dict | None) -> dict | None:
    if not doc:
        return None
    result = dict(doc)
    result["id"] = str(result.pop("_id"))
    return result


def require_worker_token(x_worker_token: str = Header(default="", alias="X-Worker-Token")) -> str:
    expected = os.environ.get("DESKTOP_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Desktop worker is not configured")
    if not x_worker_token or not hmac.compare_digest(x_worker_token, expected):
        raise HTTPException(status_code=401, detail="Invalid desktop worker token")
    return x_worker_token


async def sync_source_record(job: dict, *, success: bool, result: dict | None = None,
                             error: str = "") -> None:
    """Keep the business record in step with its desktop automation job."""
    source_id = str(job.get("source_record_id") or "")
    job_id = str(job.get("_id"))
    timestamp = now_iso()
    output = result or {}
    job_type = job.get("job_type")

    if job_type == "portal_validation":
        checks = output.get("checks") or []
        passed = sum(item.get("status") == "ok" for item in checks)
        await db.settings.update_one(
            {"key": "last_portal_validation"},
            {"$set": {"value": {
                "timestamp": timestamp, "attempt_login": True,
                "passed": passed, "total": len(checks),
                "all_ok": bool(success and checks and passed == len(checks)),
                "failed_steps": [item.get("step", "Unknown") for item in checks
                                 if item.get("status") != "ok"],
                "error": error if not success else "",
            }}}, upsert=True,
        )
        return

    if not ObjectId.is_valid(source_id):
        return
    source_oid = ObjectId(source_id)
    owned = {"desktop_job_id": job_id}

    if job_type == "asn_creation":
        fields = {"status": "Dry Run Ready" if success and output.get("dry_run") else ("Completed" if success else "Failed"),
                  "error_message": "" if success else error, "updated_at": timestamp}
        if success:
            fields.update({"asn_number": output.get("asn_number", ""), "completed_at": timestamp})
        updated = await db.asn_creation.find_one_and_update(
            {"_id": source_oid, **owned}, {"$set": fields}, return_document=ReturnDocument.AFTER,
        )
        if success and updated and output.get("asn_number") and ObjectId.is_valid(
                updated.get("master_dispatch_id", "")):
            master_oid = ObjectId(updated["master_dispatch_id"])
            await db.master_dispatch.update_one(
                {"_id": master_oid}, {"$set": {
                    "asn_number": output["asn_number"], "status": "ready_for_eway",
                    "updated_at": timestamp,
                }},
            )
            await db.master_dispatch.update_one(
                {"_id": master_oid, "documents.type": "PDI"}, {"$set": {
                    "documents.$.upload_status": "Uploaded to Portal",
                    "documents.$.last_upload_at": timestamp,
                    "pdi_upload_status": "Uploaded to Portal", "pdi_last_upload_at": timestamp,
                }},
            )
        return

    if job_type == "eway_bill_entry":
        fields = {
            "status": "Completed" if success else "Failed", "updated_at": timestamp,
            "error": None if success else error,
        }
        if success:
            fields.update({"completed_time": timestamp, "retry_count": 0,
                           "submitted_by": job.get("created_by", "desktop-worker")})
        else:
            fields["retry_count"] = int(job.get("attempts") or 1)
        updated = await db.eway_submissions.update_one(
            {"record_id": source_id, **owned}, {"$set": fields},
        )
        if success and updated.matched_count:
            await db.master_dispatch.update_one(
                {"_id": source_oid}, {"$set": {"status": "completed", "updated_at": timestamp}},
            )
        return

    if job_type == "vendor_eway_acknowledgement":
        fields = {
            "status": "Completed" if success else "Failed", "updated_at": timestamp,
            "portal_message": output.get("message", "Completed") if success else error,
        }
        if success:
            ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
            fields.update({"ack_date": ist.strftime("%Y-%m-%d"),
                           "ack_time": ist.strftime("%H:%M:%S")})
        await db.vendor_eway_acknowledgement.update_one(
            {"_id": source_oid, **owned}, {"$set": fields},
        )


class WorkerRegistration(BaseModel):
    worker_name: str = Field(min_length=1, max_length=80)
    hostname: str = Field(default="", max_length=120)
    version: str = Field(default="1.0.0", max_length=30)
    capabilities: list[str] = []


class HeartbeatInput(BaseModel):
    worker_name: str = Field(min_length=1, max_length=80)
    current_job_id: str | None = None
    state: Literal["idle", "running", "error"] = "idle"
    message: str = Field(default="", max_length=500)


class WorkerOfflineInput(BaseModel):
    worker_name: str = Field(min_length=1, max_length=80)
    message: str = Field(default="Worker stopped", max_length=500)


class JobCreateInput(BaseModel):
    job_type: str
    payload: dict[str, Any] = {}
    source_record_id: str = ""
    test_mode: bool = True
    priority: int = Field(default=100, ge=1, le=999)


class JobProgressInput(BaseModel):
    progress: int = Field(default=0, ge=0, le=100)
    message: str = Field(default="", max_length=1000)
    event: str = Field(default="Progress", max_length=100)


class JobCompleteInput(BaseModel):
    result: dict[str, Any] = {}
    message: str = Field(default="Completed", max_length=1000)


class JobFailInput(BaseModel):
    error: str = Field(min_length=1, max_length=4000)
    retryable: bool = False
    result: dict[str, Any] = {}


@router.post("/register")
async def register_worker(payload: WorkerRegistration, _: str = Depends(require_worker_token)):
    timestamp = now_iso()
    capabilities = sorted(set(payload.capabilities) & JOB_TYPES)
    if not capabilities:
        raise HTTPException(status_code=400, detail="Worker has no supported capabilities")
    existing = await db.automation_workers.find_one({"worker_name": payload.worker_name})
    if existing and existing.get("hostname") not in ("", payload.hostname):
        try:
            from datetime import datetime
            still_online = (datetime.fromisoformat(existing.get("last_heartbeat", ""))
                            >= utcnow() - timedelta(seconds=90))
        except Exception:
            still_online = False
        if still_online:
            raise HTTPException(status_code=409, detail="Worker name is already active on another desktop")
    await db.automation_workers.update_one(
        {"worker_name": payload.worker_name},
        {"$set": {
            **payload.model_dump(), "capabilities": capabilities,
            "status": "online", "state": "idle",
            "last_heartbeat": timestamp, "updated_at": timestamp,
        }, "$setOnInsert": {"created_at": timestamp, "active": True}},
        upsert=True,
    )
    return {"ok": True, "worker": payload.worker_name, "server_time": timestamp}


@router.post("/heartbeat")
async def heartbeat(payload: HeartbeatInput, _: str = Depends(require_worker_token)):
    timestamp = now_iso()
    result = await db.automation_workers.update_one(
        {"worker_name": payload.worker_name},
        {"$set": {
            "status": "online", "state": payload.state, "message": payload.message,
            "current_job_id": payload.current_job_id, "last_heartbeat": timestamp,
            "updated_at": timestamp,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Worker is not registered")
    return {"ok": True, "server_time": timestamp}


@router.post("/offline")
async def worker_offline(payload: WorkerOfflineInput, _: str = Depends(require_worker_token)):
    timestamp = now_iso()
    result = await db.automation_workers.update_one(
        {"worker_name": payload.worker_name},
        {"$set": {"status": "offline", "state": "idle", "message": payload.message,
                  "current_job_id": None, "updated_at": timestamp}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Worker is not registered")
    return {"ok": True, "server_time": timestamp}


@router.post("/jobs/claim")
async def claim_job(worker_name: str, _: str = Depends(require_worker_token)):
    timestamp = now_iso()
    worker = await db.automation_workers.find_one({"worker_name": worker_name, "active": {"$ne": False}})
    if not worker:
        raise HTTPException(status_code=403, detail="Worker is not registered or is disabled")
    capabilities = list(set(worker.get("capabilities") or []) & JOB_TYPES)
    if not capabilities:
        raise HTTPException(status_code=403, detail="Worker has no supported capabilities")
    job = await db.automation_jobs.find_one_and_update(
        {"status": "pending", "job_type": {"$in": capabilities}},
        {"$set": {
            "status": "claimed", "worker_name": worker_name,
            "claimed_at": timestamp, "updated_at": timestamp,
        }, "$inc": {"attempts": 1}},
        sort=[("priority", 1), ("created_at", 1)],
        return_document=ReturnDocument.AFTER,
    )
    return {"job": serialize(job)}


@router.post("/jobs/{job_id}/start")
async def start_job(job_id: str, worker_name: str, _: str = Depends(require_worker_token)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    job = await db.automation_jobs.find_one_and_update(
        {"_id": ObjectId(job_id), "status": "claimed", "worker_name": worker_name},
        {"$set": {"status": "running", "started_at": timestamp, "updated_at": timestamp}},
        return_document=ReturnDocument.AFTER,
    )
    if not job:
        raise HTTPException(status_code=409, detail="Job is not claimable by this worker")
    return serialize(job)


@router.post("/jobs/{job_id}/progress")
async def update_progress(job_id: str, payload: JobProgressInput, worker_name: str,
                          _: str = Depends(require_worker_token)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    log = {"ts": timestamp, "event": payload.event, "message": payload.message, "level": "INFO"}
    result = await db.automation_jobs.update_one(
        {"_id": ObjectId(job_id), "worker_name": worker_name, "status": {"$in": ["claimed", "running"]}},
        {"$set": {"progress": payload.progress, "message": payload.message, "updated_at": timestamp},
         "$push": {"logs": log}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Job is not active for this worker")
    return {"ok": True}


@router.post("/jobs/{job_id}/complete")
async def complete_job(job_id: str, payload: JobCompleteInput, worker_name: str,
                       _: str = Depends(require_worker_token)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    job = await db.automation_jobs.find_one_and_update(
        {"_id": ObjectId(job_id), "worker_name": worker_name, "status": {"$in": ["claimed", "running"]}},
        {"$set": {"status": "success", "progress": 100, "message": payload.message,
                  "result": payload.result, "completed_at": timestamp, "updated_at": timestamp}},
        return_document=ReturnDocument.AFTER,
    )
    if not job:
        raise HTTPException(status_code=409, detail="Job is not active for this worker")
    await sync_source_record(job, success=True, result=payload.result)
    return {"ok": True}


@router.post("/jobs/{job_id}/fail")
async def fail_job(job_id: str, payload: JobFailInput, worker_name: str,
                   _: str = Depends(require_worker_token)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    job = await db.automation_jobs.find_one_and_update(
        {"_id": ObjectId(job_id), "worker_name": worker_name, "status": {"$in": ["claimed", "running"]}},
        {"$set": {"status": "failed", "error": payload.error, "retryable": payload.retryable,
                  "result": payload.result, "completed_at": timestamp, "updated_at": timestamp}},
        return_document=ReturnDocument.AFTER,
    )
    if not job:
        raise HTTPException(status_code=409, detail="Job is not active for this worker")
    await sync_source_record(job, success=False, result=payload.result, error=payload.error)
    return {"ok": True}


@router.get("/jobs/{job_id}/document")
async def download_job_document(job_id: str, worker_name: str,
                                _: str = Depends(require_worker_token)):
    """Stream the source PDI to a claimed desktop worker without exposing its path."""
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    job = await db.automation_jobs.find_one(
        {"_id": ObjectId(job_id), "worker_name": worker_name,
         "status": {"$in": ["claimed", "running"]}, "job_type": "asn_creation"}
    )
    if not job:
        raise HTTPException(status_code=404, detail="Active ASN job not found")
    source_id = str(job.get("source_record_id") or "")
    if not ObjectId.is_valid(source_id):
        raise HTTPException(status_code=404, detail="ASN source record not found")
    record = await db.asn_creation.find_one({"_id": ObjectId(source_id), "desktop_job_id": job_id})
    path_value = (record or {}).get("pdi_file_path")
    if not path_value:
        raise HTTPException(status_code=404, detail="PDI document is not available")
    path = Path(path_value).resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="PDI document is not available")
    return FileResponse(path, filename=path.name, media_type="application/pdf")


@router.post("/jobs", dependencies=[Depends(require_admin)])
async def create_job(payload: JobCreateInput, user: dict = Depends(get_current_user)):
    if payload.job_type not in JOB_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported job type: {payload.job_type}")
    return await create_automation_job(
        job_type=payload.job_type,
        payload=payload.payload,
        source_record_id=payload.source_record_id,
        created_by=user.get("username", "admin"),
        test_mode=payload.test_mode,
        priority=payload.priority,
    )


@router.get("/status")
async def worker_status(user: dict = Depends(get_current_user)):
    cutoff = utcnow() - timedelta(seconds=90)
    workers = await db.automation_workers.find({}).sort("last_heartbeat", -1).to_list(20)
    output = []
    for worker in workers:
        item = serialize(worker)
        last = worker.get("last_heartbeat", "")
        try:
            from datetime import datetime
            is_online = datetime.fromisoformat(last) >= cutoff
        except Exception:
            is_online = False
        item["online"] = is_online
        output.append(item)
    return {"workers": output}


@router.put("/workers/{worker_name}/active", dependencies=[Depends(require_admin)])
async def set_worker_active(worker_name: str, payload: dict, user: dict = Depends(get_current_user)):
    if "active" not in payload:
        raise HTTPException(status_code=400, detail="active is required")
    timestamp = now_iso()
    result = await db.automation_workers.update_one(
        {"worker_name": worker_name},
        {"$set": {"active": bool(payload["active"]), "updated_at": timestamp}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Worker not found")
    return {"ok": True, "worker_name": worker_name, "active": bool(payload["active"])}


@router.get("/jobs")
async def list_jobs(status: str = "", limit: int = 100, user: dict = Depends(get_current_user)):
    query = {"status": status} if status else {}
    docs = await db.automation_jobs.find(query).sort("created_at", -1).to_list(min(max(limit, 1), 500))
    return {"items": [serialize(doc) for doc in docs]}


@router.post("/jobs/{job_id}/retry", dependencies=[Depends(require_admin)])
async def retry_job(job_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    job = await db.automation_jobs.find_one_and_update(
        {"_id": ObjectId(job_id), "status": "failed"},
        {"$set": {"status": "pending", "worker_name": "", "error": "", "progress": 0,
                  "message": "Queued for retry", "updated_at": timestamp}},
        return_document=ReturnDocument.AFTER,
    )
    if not job:
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried")
    return serialize(job)


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_admin)])
async def cancel_job(job_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    result = await db.automation_jobs.update_one(
        {"_id": ObjectId(job_id), "status": {"$in": ["pending", "claimed"]}},
        {"$set": {"status": "cancelled", "completed_at": timestamp, "updated_at": timestamp}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Running or completed jobs cannot be cancelled")
    return {"ok": True}
