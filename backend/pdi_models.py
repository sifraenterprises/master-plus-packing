from typing import Optional
from pydantic import BaseModel, Field
from models import BaseDocument, utcnow


class PdiRow(BaseModel):
    sr: str = ""
    specified_dimension: str = ""
    method: str = ""
    freq: str = ""
    nominal: Optional[float] = None
    tol_low: Optional[float] = None
    tol_high: Optional[float] = None
    value_type: str = "dimension"  # dimension | visual
    page: int = 1
    remarks: str = ""


class PdiTemplate(BaseDocument):
    page_number: int = 0
    part_name: str = ""
    item_code: str = ""
    drg_no: str = ""
    rows: list[PdiRow] = []
    layouts: list[dict] = []
    pages: int = 1
    source_pdf: str = ""
    revision: int = 1
    mapped_parts: list[str] = []
    customer: str = ""
    plant: str = ""
    effective_from: str = ""
    effective_to: str = ""
    status: str = "active"  # active | inactive
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: utcnow().isoformat())


class PdiTemplateCreate(BaseModel):
    upload_id: str
    page_start: int = 1
    page_end: int = 1
    part_name: str = ""
    item_code: str = ""
    drg_no: str = ""
    rows: list[PdiRow] = []
    mapped_parts: list[str] = []
    customer: str = ""
    plant: str = ""
    effective_from: str = ""
    effective_to: str = ""
    status: str = "active"


class PdiTemplateUpdate(BaseModel):
    part_name: Optional[str] = None
    item_code: Optional[str] = None
    drg_no: Optional[str] = None
    status: Optional[str] = None
    rows: Optional[list[PdiRow]] = None
    mapped_parts: Optional[list[str]] = None
    customer: Optional[str] = None
    plant: Optional[str] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    upload_id: Optional[str] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None


class PdiDraftPreview(BaseModel):
    upload_id: str
    page_start: int = 1
    page_end: int = 1
    rows: list[PdiRow] = []


class PdiGenerateInput(BaseModel):
    template_id: str = ""
    master_dispatch_id: str = ""
    part_identifier: str = ""
    part_name: str = ""
    item_code: str = ""
    report_date: str = ""
    lot_size: str = ""
    lot_no: str = ""
    challan_no_dt: str = ""
    min_no_dt: str = ""
    vender_code: str = ""
    inspector: str = ""
    approver: str = ""
    sample_count: int = 10
    parameters_note: str = "All dimensions as per drawing"
    identification_mark: str = "Sticker on box"


class PdiReport(BaseDocument):
    report_no: str = ""
    template_id: str = ""
    template_revision: int = 1
    page_number: int = 0
    part_name: str = ""
    item_code: str = ""
    drg_no: str = ""
    master_dispatch_id: str = ""
    invoice_number: str = ""
    customer_name: str = ""
    report_date: str = ""
    lot_size: str = ""
    lot_no: str = ""
    challan_no_dt: str = ""
    min_no_dt: str = ""
    vender_code: str = ""
    inspector: str = ""
    approver: str = ""
    parameters_note: str = ""
    identification_mark: str = ""
    observations: list[list[str]] = []
    sample_count: int = 10
    pdf_path: str = ""
    source: str = "ai"  # ai | manual
    status: str = "generated"  # generated | regenerated | manual
    regenerated_count: int = 0
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: utcnow().isoformat())
