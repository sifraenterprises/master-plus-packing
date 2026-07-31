from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user, require_admin
from database import db
from models import utcnow
from routes.worker_routes import (
    compatible_worker_online,
    create_automation_job,
    require_desktop_worker,
)

router = APIRouter(prefix="/dqms", tags=["dqms"])

PARTS = [
    {"code": "2563770", "name": "SCREW STUD"},
    {"code": "93321058", "name": "FOOT ACCELERATOR SHAFT"},
    {"code": "93333206", "name": "FULCRUM PIN"},
    {"code": "93337157", "name": "PIN - LOWER LINK"},
    {"code": "93337352", "name": "HAND ACCELERATOR ROD"},
    {"code": "1040686", "name": "SECURING NUT"},
    {"code": "93333528", "name": "PIN FOR CLUTCH"},
    {"code": "93327711", "name": "ACC LINKAGE ASSY (330-540)"},
    {"code": "93489528", "name": "Accelerator Linkage Sub Assy"},
    {"code": "93489802", "name": "Acc Link Sub Assbly"},
    {"code": "1611999", "name": "PIN BIG"},
]


def serialize(doc):
    if not doc:
        return None
    output = dict(doc)
    output["id"] = str(output.pop("_id"))
    return output


class DqmsCharacteristic(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    nominal: Optional[float] = None
    lower_limit: float
    upper_limit: float
    measured_value: Optional[float] = None
    unit: str = Field(default="mm", max_length=20)

    @field_validator("upper_limit")
    @classmethod
    def validate_limits(cls, value: float, info):
        lower = info.data.get("lower_limit")
        if lower is not None and value < lower:
            raise ValueError("upper_limit must be greater than or equal to lower_limit")
        return value


class DqmsBatchInput(BaseModel):
    part_number: str = Field(min_length=1, max_length=40)
    part_name: str = Field(default="", max_length=160)
    process: str = Field(min_length=1, max_length=120)
    machine: str = Field(min_length=1, max_length=120)
    operator: str = Field(min_length=1, max_length=120)
    inspector: str = Field(min_length=1, max_length=120)
    shift: str = Field(min_length=1, max_length=80)
    quantity: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    remarks: str = Field(default="", max_length=500)
    dimension_source: Literal["manual", "pdi_template"] = "manual"
    pdi_template: str = Field(default="", max_length=260)
    characteristics: list[DqmsCharacteristic] = Field(default_factory=list, max_length=200)
    stop_before_create: bool = True

    @field_validator("part_number", "process", "machine", "operator", "inspector", "shift")
    @classmethod
    def strip_required(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("characteristics")
    @classmethod
    def validate_measurements(cls, values: list[DqmsCharacteristic]):
        for item in values:
            if item.measured_value is not None and not (
                item.lower_limit <= item.measured_value <= item.upper_limit
            ):
                raise ValueError(
                    f"{item.name}: measured value must be within "
                    f"{item.lower_limit}–{item.upper_limit}"
                )
        return values


@router.get("/masters")
async def masters(user: dict = Depends(get_current_user)):
    saved = await db.settings.find_one({"key": "dqms_masters"})
    values = (saved or {}).get("value") or {}
    return {
        "parts": values.get("parts") or PARTS,
        "processes": values.get("processes") or [],
        "machines": values.get("machines") or [],
        "operators": values.get("operators") or [],
        "inspectors": values.get("inspectors") or [],
        "shifts": values.get("shifts") or [],
        "source": "worker-sync" if saved else "initial-observation",
    }


@router.put("/masters", dependencies=[Depends(require_admin)])
async def update_masters(payload: dict, user: dict = Depends(get_current_user)):
    allowed = {"parts", "processes", "machines", "operators", "inspectors", "shifts"}
    value = {key: payload.get(key, []) for key in allowed}
    await db.settings.update_one(
        {"key": "dqms_masters"},
        {"$set": {"value": value, "updated_at": utcnow().isoformat(),
                  "updated_by": user["username"]}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/status")
async def status(user: dict = Depends(get_current_user)):
    return {
        "worker_online": await compatible_worker_online("dqms_start_batch"),
        "safe_default": True,
    }


@router.get("/batches")
async def list_batches(limit: int = 100, user: dict = Depends(get_current_user)):
    docs = await db.dqms_batches.find({}).sort("created_at", -1).to_list(
        min(max(limit, 1), 500)
    )
    return {"items": [serialize(doc) for doc in docs]}


@router.post("/batches")
async def queue_batch(payload: DqmsBatchInput, user: dict = Depends(get_current_user)):
    await require_desktop_worker("dqms_start_batch")
    if payload.part_name:
        saved = await db.settings.find_one({"key": "dqms_masters"})
        values = (saved or {}).get("value") or {}
        parts = values.get("parts") or PARTS.copy()
        if not any(str(part.get("code")) == payload.part_number for part in parts):
            parts.append({"code": payload.part_number, "name": payload.part_name.strip()})
            values["parts"] = parts
            await db.settings.update_one(
                {"key": "dqms_masters"},
                {"$set": {"value": values, "updated_at": utcnow().isoformat(),
                          "updated_by": user["username"]}},
                upsert=True,
            )
    timestamp = utcnow().isoformat()
    source = {
        **payload.model_dump(),
        "status": "Queued",
        "batch_number": "",
        "desktop_job_id": "",
        "error_message": "",
        "created_by": user["username"],
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    inserted = await db.dqms_batches.insert_one(source)
    source_id = str(inserted.inserted_id)
    job = await create_automation_job(
        job_type="dqms_start_batch",
        payload=payload.model_dump(),
        source_record_id=source_id,
        created_by=user["username"],
        test_mode=payload.stop_before_create,
        priority=70,
    )
    await db.dqms_batches.update_one(
        {"_id": inserted.inserted_id},
        {"$set": {"desktop_job_id": job["id"], "updated_at": utcnow().isoformat()}},
    )
    return {"batch": serialize(await db.dqms_batches.find_one({"_id": inserted.inserted_id})),
            "job": job}


@router.post("/batches/{batch_id}/retry", dependencies=[Depends(require_admin)])
async def retry_batch(batch_id: str, user: dict = Depends(get_current_user)):
    if not ObjectId.is_valid(batch_id):
        raise HTTPException(status_code=400, detail="Invalid DQMS batch id")
    record = await db.dqms_batches.find_one({"_id": ObjectId(batch_id)})
    if not record:
        raise HTTPException(status_code=404, detail="DQMS batch not found")
    if record.get("status") not in {"Failed", "Ready for Review"}:
        raise HTTPException(status_code=409, detail="Only failed or review-ready batches can be retried")
    await require_desktop_worker("dqms_start_batch")
    payload = {key: record.get(key) for key in DqmsBatchInput.model_fields}
    job = await create_automation_job(
        job_type="dqms_start_batch", payload=payload, source_record_id=batch_id,
        created_by=user["username"], test_mode=bool(record.get("stop_before_create", True)),
        priority=70,
    )
    await db.dqms_batches.update_one(
        {"_id": ObjectId(batch_id)},
        {"$set": {"status": "Queued", "desktop_job_id": job["id"],
                  "error_message": "", "updated_at": utcnow().isoformat()}},
    )
    return {"job": job}
