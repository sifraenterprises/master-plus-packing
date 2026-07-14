import re
from pydantic import BaseModel, Field, field_validator
from models import BaseDocument, utcnow

MD_STATUSES = ("pending", "ready_for_asn", "ready_for_eway", "completed")


class MDItem(BaseModel):
    part_number: str = ""
    description: str = ""
    hsn: str = ""
    quantity: float = 0
    unit: str = ""
    rate: float = 0
    amount: float = 0


class MasterDispatch(BaseDocument):
    dispatch_no: str = ""
    customer_name: str = ""
    customer_code: str = ""
    gstin: str = ""
    invoice_number: str = ""
    invoice_date: str = ""
    po_number: str = ""
    po_date: str = ""
    items: list[MDItem] = []
    boxes: int = 0
    gross_weight: str = ""
    net_weight: str = ""
    vehicle_number: str = ""
    lr_number: str = ""
    transporter_name: str = ""
    cgst: float = 0
    sgst: float = 0
    igst: float = 0
    gst_total: float = 0
    invoice_total: float = 0
    eway_bill_number: str = ""
    irn: str = ""
    ack_number: str = ""
    remarks: str = ""
    status: str = "pending"
    verified: bool = False
    ocr_status: str = "manual"  # manual | extracted | error
    confidence: dict = {}
    low_confidence_fields: list[str] = []
    source_file_id: str = ""
    split_file_id: str = ""
    batch_id: str = ""
    page_start: int = 0
    page_end: int = 0
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: utcnow().isoformat())


class MasterDispatchInput(BaseModel):
    customer_name: str = ""
    customer_code: str = ""
    gstin: str = ""
    invoice_number: str = ""
    invoice_date: str = ""
    po_number: str = ""
    po_date: str = ""
    items: list[MDItem] = []
    boxes: int = 0
    gross_weight: str = ""
    net_weight: str = ""
    vehicle_number: str = ""
    lr_number: str = ""
    transporter_name: str = ""
    cgst: float = 0
    sgst: float = 0
    igst: float = 0
    gst_total: float = 0
    invoice_total: float = 0
    eway_bill_number: str = ""
    irn: str = ""
    ack_number: str = ""
    remarks: str = ""
    status: str = Field(default="pending", pattern="^(pending|ready_for_asn|ready_for_eway|completed)$")
    verified: bool = False

    @field_validator("eway_bill_number")
    @classmethod
    def normalize_eway_bill(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v or "")
        return digits if len(digits) == 12 else (v or "").strip()
