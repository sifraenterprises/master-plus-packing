from typing import Annotated, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict

PyObjectId = Annotated[str, BeforeValidator(str)]


def utcnow():
    return datetime.now(timezone.utc)


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True)
        data.pop("_id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict):
        if not doc:
            return None
        return cls.model_validate(doc)


class User(BaseDocument):
    username: str
    name: str
    role: str  # "admin" | "dispatch"
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6, max_length=128)
    role: str = Field(pattern="^(admin|dispatch)$")


class LoginRequest(BaseModel):
    username: str
    password: str


class DispatchEntry(BaseDocument):
    dispatch_id: str = ""
    invoice_number: str = ""
    invoice_date: str = ""
    customer_name: str = ""
    customer_code: str = ""
    po_number: str = ""
    part_number: str = ""
    part_description: str = ""
    quantity: float = 0
    unit: str = ""
    rate: float = 0
    total_value: float = 0
    gst: str = ""
    vehicle: str = ""
    dispatch_date: str = ""
    vendor_name: str = ""
    remarks: str = ""
    pdf_id: str = ""
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: utcnow().isoformat())


class DispatchEntryInput(BaseModel):
    invoice_number: str = ""
    invoice_date: str = ""
    customer_name: str = ""
    customer_code: str = ""
    po_number: str = ""
    part_number: str = ""
    part_description: str = ""
    quantity: float = 0
    unit: str = ""
    rate: float = 0
    total_value: float = 0
    gst: str = ""
    vehicle: str = ""
    dispatch_date: str = ""
    vendor_name: str = ""
    remarks: str = ""
    pdf_id: str = ""


class BulkDispatchInput(BaseModel):
    entries: list[DispatchEntryInput]


class CompanyProfile(BaseModel):
    company_name: str = "Grewal Engineering Work"
    introduction: str = ""
    vision: str = ""
    mission: str = ""
    products: str = ""
    services: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    address: str = ""
    published: bool = False


class ModuleConfig(BaseDocument):
    key: str
    name: str
    description: str
    status: str = "coming_soon"
    enabled: bool = False
    icon: str = ""


class PackingSlip(BaseDocument):
    invoice_number: str = ""
    item_name: str = ""
    item_code: str = ""
    total_quantity: float = 0
    single_packet_qty: float = 0
    boxes: int = 1
    inside_cards: int = 0
    lot_number: str = ""
    pdi_number: str = ""
    customer_name: str = ""
    customer_address: str = ""
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: utcnow().isoformat())


class PackingSlipInput(BaseModel):
    invoice_number: str = ""
    item_name: str = ""
    item_code: str = ""
    total_quantity: float = 0
    single_packet_qty: float = 0
    boxes: int = Field(default=1, ge=1, le=500)
    inside_cards: int = Field(default=0, ge=0, le=1000)
    lot_number: str = ""
    pdi_number: str = ""
    customer_name: str = ""
    customer_address: str = ""
