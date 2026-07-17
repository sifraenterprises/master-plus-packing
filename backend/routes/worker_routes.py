import hmac
import os
import uuid
from datetime import timedelta
from typing import Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, HTTPException
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
    await db.automation_workers.update_one(
        {"worker_name": payload.worker_name},
        {"$set": {
            **payload.model_dump(), "status": "online", "state": "idle",
            "last_heartbeat": timestamp, "updated_at": timestamp,
        }, "$setOnInsert": {"created_at": timestamp}},
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


@router.post("/jobs/claim")
async def claim_job(worker_name: str, _: str = Depends(require_worker_token)):
    timestamp = now_iso()
    job = await db.automation_jobs.find_one_and_update(
        {"status": "pending"},
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
    result = await db.automation_jobs.update_one(
        {"_id": ObjectId(job_id), "worker_name": worker_name, "status": {"$in": ["claimed", "running"]}},
        {"$set": {"status": "success", "progress": 100, "message": payload.message,
                  "result": payload.result, "completed_at": timestamp, "updated_at": timestamp}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Job is not active for this worker")
    return {"ok": True}


@router.post("/jobs/{job_id}/fail")
async def fail_job(job_id: str, payload: JobFailInput, worker_name: str,
                   _: str = Depends(require_worker_token)):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    timestamp = now_iso()
    result = await db.automation_jobs.update_one(
        {"_id": ObjectId(job_id), "worker_name": worker_name, "status": {"$in": ["claimed", "running"]}},
        {"$set": {"status": "failed", "error": payload.error, "retryable": payload.retryable,
                  "result": payload.result, "completed_at": timestamp, "updated_at": timestamp}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Job is not active for this worker")
    return {"ok": True}


@router.post("/jobs", dependencies=[Depends(require_admin)])
async def create_job(payload: JobCreateInput, user: dict = Depends(get_current_user)):
    if payload.job_type not in JOB_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported job type: {payload.job_type}")
    timestamp = now_iso()
    doc = {
        "job_id": str(uuid.uuid4()), "job_type": payload.job_type, "status": "pending",
        "payload": payload.payload, "source_record_id": payload.source_record_id,
        "test_mode": payload.test_mode, "priority": payload.priority, "attempts": 0,
        "progress": 0, "message": "Queued", "logs": [], "worker_name": "",
        "created_by": user.get("username", "admin"), "created_at": timestamp, "updated_at": timestamp,
    }
    inserted = await db.automation_jobs.insert_one(doc)
    return serialize(await db.automation_jobs.find_one({"_id": inserted.inserted_id}))


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
