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
    remarks: str = ""


class PdiTemplate(BaseDocument):
    page_number: int = 0
    part_name: str = ""
    item_code: str = ""
    drg_no: str = ""
    rows: list[PdiRow] = []
    layout: dict = {}
    source_pdf: str = ""
    status: str = "active"
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: utcnow().isoformat())


class PdiTemplateUpdate(BaseModel):
    part_name: Optional[str] = None
    item_code: Optional[str] = None
    drg_no: Optional[str] = None
    status: Optional[str] = None
    rows: Optional[list[PdiRow]] = None


class PdiGenerateInput(BaseModel):
    template_id: str = ""
    master_dispatch_id: str = ""
    part_identifier: str = ""
    report_date: str = ""
    lot_size: str = ""
    lot_no: str = ""
    challan_no_dt: str = ""
    min_no_dt: str = ""
    vender_code: str = ""
    inspector: str = ""
    approver: str = ""
    parameters_note: str = "All dimensions as per drawing"
    identification_mark: str = "Sticker on box"


class PdiReport(BaseDocument):
    report_no: str = ""
    template_id: str = ""
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
    pdf_path: str = ""
    status: str = "generated"  # generated | regenerated
    regenerated_count: int = 0
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: utcnow().isoformat())
