"""Pydantic v2 models. Mirror: frontend/src/lib/types.ts — keep in sync."""

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["admin", "kasir"]


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- auth / users ----------
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=100)


class User(BaseModel):
    id: str
    username: str
    full_name: str
    role: Role
    active: bool = True


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.]+$")
    full_name: str = Field(min_length=1, max_length=100)
    role: Role
    password: str = Field(min_length=6, max_length=100)


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    role: Role
    active: bool
    password: str | None = Field(default=None, max_length=100)


# ---------- categories ----------
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = ""


class Category(CategoryIn):
    id: str = Field(default_factory=_id)
    product_count: int = 0


# ---------- products ----------
class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    barcode: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    category_id: str | None = None
    unit: str = Field(default="pcs", max_length=20)
    buy_price: float = Field(ge=0)
    sell_price: float = Field(ge=0)
    stock: float = Field(default=0, ge=0)
    min_stock: float = Field(default=0, ge=0)
    supplier: str = ""
    photo_url: str = ""
    active: bool = True


class Product(ProductIn):
    id: str = Field(default_factory=_id)
    category_name: str | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class StockAdjustIn(BaseModel):
    product_id: str
    type: Literal["stock_in", "stock_out", "adjustment"]
    qty: float = Field(ge=0)
    note: str = ""


class StockMovement(BaseModel):
    id: str
    product_id: str
    product_name: str
    type: str
    qty: float
    stock_before: float
    stock_after: float
    username: str
    note: str
    created_at: datetime


# ---------- sales ----------
PaymentMethod = Literal["cash", "qris", "transfer", "debit", "kredit", "ewallet"]


class SaleItemIn(BaseModel):
    product_id: str
    qty: float = Field(gt=0)
    discount: float = Field(default=0, ge=0)  # nominal discount per line


class SaleIn(BaseModel):
    items: list[SaleItemIn] = Field(min_length=1)
    discount_type: Literal["nominal", "percent"] = "nominal"
    discount_value: float = Field(default=0, ge=0)
    payment_method: PaymentMethod
    amount_paid: float = Field(ge=0)


class SaleItem(BaseModel):
    product_id: str
    name: str
    unit: str
    qty: float
    price: float
    buy_price: float
    discount: float
    subtotal: float


class Sale(BaseModel):
    id: str
    invoice_no: str
    items: list[SaleItem]
    subtotal: float
    discount: float
    tax: float
    total: float
    payment_method: str
    amount_paid: float
    change: float
    cashier_name: str
    status: Literal["completed", "void"]
    void_reason: str | None = None
    date: str
    created_at: datetime


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


# ---------- settings ----------
class Settings(BaseModel):
    store_name: str = "WARUNG BU CUCUN"
    address: str = "Jl. Raya Pasar No. 12"
    whatsapp: str = "0812-3456-7890"
    receipt_footer: str = "Terima kasih\nBelanja kembali"
    paper_size: Literal["58", "80"] = "58"
    tax_percent: float = Field(default=0, ge=0, le=100)
    currency: str = "Rp"
    invoice_prefix: str = "INV"
    payment_methods: list[str] = ["cash", "qris", "transfer", "debit", "kredit", "ewallet"]


# ---------- dashboard ----------
class ChartPoint(BaseModel):
    date: str
    total: float
    count: int


class LowStockItem(BaseModel):
    id: str
    name: str
    stock: float
    min_stock: float
    unit: str


class Dashboard(BaseModel):
    start: str
    end: str
    total_sales: float
    transaction_count: int
    items_sold: float
    profit: float
    low_stock: list[LowStockItem]
    out_of_stock: list[LowStockItem]
    recent_sales: list[Sale]
    chart: list[ChartPoint]
    payment_breakdown: dict[str, float]


# ---------- suppliers & purchases ----------
class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    contact_name: str = ""
    phone: str = ""
    address: str = ""
    note: str = ""


class Supplier(SupplierIn):
    id: str = Field(default_factory=_id)
    purchase_count: int = 0
    purchase_total: float = 0


class PurchaseItemIn(BaseModel):
    product_id: str
    qty: float = Field(gt=0)
    buy_price: float = Field(ge=0)


class PurchaseIn(BaseModel):
    supplier_id: str
    invoice_no: str = Field(min_length=1, max_length=60)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    items: list[PurchaseItemIn] = Field(min_length=1)
    note: str = ""
    update_buy_price: bool = True


class PurchaseItem(BaseModel):
    product_id: str
    name: str
    unit: str
    qty: float
    buy_price: float
    subtotal: float


class Purchase(BaseModel):
    id: str
    supplier_id: str
    supplier_name: str
    invoice_no: str
    date: str
    items: list[PurchaseItem]
    total: float
    note: str
    username: str
    created_at: datetime
