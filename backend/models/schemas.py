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
    permissions: list[str] = []  # effective permissions (admin = all)
    has_pin: bool = False


class PermissionInfo(BaseModel):
    key: str
    label: str
    default: bool


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.]+$")
    full_name: str = Field(min_length=1, max_length=100)
    role: Role
    password: str = Field(min_length=6, max_length=100)
    permissions: list[str] | None = None


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    role: Role
    active: bool
    password: str | None = Field(default=None, max_length=100)
    permissions: list[str] | None = None


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
    wholesale_tiers: list["WholesaleTier"] = []
    units: list["ProductUnit"] = []
    promo_price: float | None = Field(default=None, ge=0)
    promo_start: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    promo_end: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ProductUnit(BaseModel):
    name: str = Field(min_length=1, max_length=20)  # e.g. pak, dus
    factor: float = Field(gt=1)  # base units per this unit
    price: float = Field(gt=0)
    barcode: str | None = Field(default=None, max_length=64)


class WholesaleTier(BaseModel):
    min_qty: float = Field(gt=1)
    price: float = Field(gt=0)


ProductIn.model_rebuild()


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
PaymentMethod = Literal["cash", "qris", "transfer", "debit", "kredit", "ewallet", "hutang"]


class SaleItemIn(BaseModel):
    product_id: str
    qty: float = Field(gt=0)
    discount: float = Field(default=0, ge=0)  # nominal discount per line
    unit: str | None = None  # alternative unit name; None = base unit


class SaleIn(BaseModel):
    items: list[SaleItemIn] = Field(min_length=1)
    discount_type: Literal["nominal", "percent"] = "nominal"
    discount_value: float = Field(default=0, ge=0)
    payment_method: PaymentMethod
    amount_paid: float = Field(ge=0)
    customer_id: str | None = None
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    redeem_points: int = Field(default=0, ge=0)
    approval_pin: str | None = Field(default=None, max_length=12)


class SaleItem(BaseModel):
    product_id: str
    name: str
    unit: str
    qty: float
    price: float
    buy_price: float
    discount: float
    subtotal: float
    normal_price: float = 0
    price_type: Literal["normal", "promo", "grosir"] = "normal"
    factor: float = 1  # base units per sold unit (multi-satuan)


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
    customer_id: str | None = None
    customer_name: str | None = None
    points_earned: int = 0
    points_redeemed: int = 0
    points_discount: float = 0
    date: str
    created_at: datetime


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)
    approval_pin: str | None = Field(default=None, max_length=12)


class PinIn(BaseModel):
    pin: str = Field(pattern=r"^\d{4,6}$")
    current_password: str = Field(min_length=1, max_length=100)


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
    payment_methods: list[str] = ["cash", "qris", "transfer", "debit", "kredit", "ewallet", "hutang"]
    owner_whatsapp: str = ""
    expense_categories: list[str] = ["Listrik", "Air", "Transport", "Plastik", "ATK", "Operasional", "Lainnya"]
    loyalty_enabled: bool = True
    points_per_amount: float = Field(default=10000, gt=0)  # belanja Rp X = 1 poin
    point_value: float = Field(default=100, ge=0)  # 1 poin = Rp Y saat ditukar
    min_redeem_points: int = Field(default=10, ge=0)
    max_cashier_discount_percent: float = Field(default=10, ge=0, le=100)  # above this a kasir needs an admin PIN
    expiry_warning_days: int = Field(default=30, ge=1, le=365)
    morning_summary_enabled: bool = True  # auto-send at 07:00 WIB via Fonnte (needs token)


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
    due_debts: list[dict] = []
    expiring: list[dict] = []


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
    expiry_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


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


# ---------- returns ----------
class ReturnItemIn(BaseModel):
    product_id: str
    qty: float = Field(gt=0)


class ReturnIn(BaseModel):
    type: Literal["sale", "purchase"]
    ref_id: str
    items: list[ReturnItemIn] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=200)


class ReturnItem(BaseModel):
    product_id: str
    name: str
    qty: float
    price: float
    subtotal: float


class Return(BaseModel):
    id: str
    return_no: str
    type: Literal["sale", "purchase"]
    ref_id: str
    ref_no: str
    items: list[ReturnItem]
    total: float
    reason: str
    username: str
    date: str
    created_at: datetime


# ---------- shifts ----------
class ShiftOpenIn(BaseModel):
    opening_cash: float = Field(ge=0)


class ShiftExpenseIn(BaseModel):
    amount: float = Field(gt=0)
    note: str = Field(min_length=1, max_length=200)


class ShiftCloseIn(BaseModel):
    actual_cash: float = Field(ge=0)
    note: str = ""


class ShiftExpense(BaseModel):
    amount: float
    note: str
    created_at: datetime


class ShiftSummary(BaseModel):
    transaction_count: int
    total_sales: float
    by_payment: dict[str, float]
    expenses_total: float
    refunds_cash: float
    expected_cash: float


class Shift(BaseModel):
    id: str
    user_id: str
    cashier_name: str
    status: Literal["open", "closed"]
    opening_cash: float
    opened_at: datetime
    closed_at: datetime | None = None
    expenses: list[ShiftExpense] = []
    summary: ShiftSummary | None = None
    actual_cash: float | None = None
    difference: float | None = None
    note: str = ""


# ---------- reports ----------
class DailyReport(BaseModel):
    date: str
    transaction_count: int
    items_sold: float
    omzet: float
    discount: float
    modal: float
    profit: float
    by_payment: dict[str, float]
    void_count: int
    sale_returns_total: float
    top_products: list[dict]
    expenses_total: float = 0
    expenses_by_category: dict[str, float] = {}
    net_profit: float = 0
    debt_new: float = 0
    debt_collected: float = 0


class RestockItem(BaseModel):
    id: str
    sku: str
    name: str
    unit: str
    stock: float
    min_stock: float
    suggested_qty: float
    buy_price: float
    estimated_cost: float


class RestockGroup(BaseModel):
    supplier: str
    items: list[RestockItem]
    total_cost: float


# ---------- customers & debts ----------
class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    whatsapp: str = ""
    address: str = ""
    note: str = ""


class Customer(CustomerIn):
    id: str = Field(default_factory=_id)
    member_code: str = ""
    points: int = 0
    debt_remaining: float = 0
    transaction_count: int = 0


class DebtPaymentIn(BaseModel):
    amount: float = Field(gt=0)
    note: str = ""


class DebtPayment(BaseModel):
    amount: float
    note: str
    username: str
    created_at: datetime


class Debt(BaseModel):
    id: str
    customer_id: str
    customer_name: str
    sale_id: str
    invoice_no: str
    total: float
    paid: float
    remaining: float
    due_date: str | None
    status: Literal["open", "paid"]
    payments: list[DebtPayment] = []
    created_at: datetime


# ---------- expenses ----------
class ExpenseIn(BaseModel):
    category: str = Field(min_length=1, max_length=40)
    amount: float = Field(gt=0)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str = ""


class Expense(ExpenseIn):
    id: str = Field(default_factory=_id)
    username: str = ""
    created_at: datetime = Field(default_factory=_now)


class DailyReportSnapshot(BaseModel):
    date: str
    generated_at: datetime
    source: Literal["cron", "manual"]
    report: DailyReport


# ---------- backup ----------
class BackupInfo(BaseModel):
    id: str
    filename: str
    size: int
    source: Literal["manual", "auto", "pre-restore"]
    collections: dict[str, int]
    username: str
    created_at: datetime


# ---------- import ----------
class ImportRow(BaseModel):
    row: int
    sku: str
    barcode: str | None = None
    name: str
    category: str = ""
    unit: str = "pcs"
    buy_price: float = 0
    sell_price: float = 0
    stock: float = 0
    min_stock: float = 0
    status: Literal["new", "update", "error"] = "new"
    errors: list[str] = []


class ImportCommitIn(BaseModel):
    rows: list[ImportRow] = Field(min_length=1, max_length=5000)


class ImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    new_categories: list[str]


# ---------- monthly P&L ----------
class MonthlyDay(BaseModel):
    date: str
    omzet: float
    modal: float
    profit: float
    expenses: float
    net: float
    transactions: int


class MonthlyReport(BaseModel):
    month: str
    days: list[MonthlyDay]
    omzet: float
    modal: float
    profit: float
    expenses: float
    net: float
    transactions: int


# ---------- stock opname ----------
class OpnameItemIn(BaseModel):
    product_id: str
    counted: float = Field(ge=0)


class OpnameIn(BaseModel):
    items: list[OpnameItemIn] = Field(min_length=1, max_length=5000)
    note: str = ""


class OpnameLine(BaseModel):
    product_id: str
    sku: str
    name: str
    system_stock: float
    counted: float
    diff: float
    value_diff: float


class Opname(BaseModel):
    id: str
    lines: list[OpnameLine]
    adjusted_count: int
    value_diff: float
    note: str
    username: str
    created_at: datetime


# ---------- breakdown report ----------
class BreakdownRow(BaseModel):
    name: str
    transactions: int = 0
    qty: float = 0
    omzet: float = 0
    profit: float = 0


class Breakdown(BaseModel):
    start: str
    end: str
    by_cashier: list[BreakdownRow]
    by_category: list[BreakdownRow]


# ---------- WhatsApp (Fonnte) ----------
class FonnteTokenIn(BaseModel):
    token: str = Field(max_length=200)  # empty string = remove


class FonnteStatus(BaseModel):
    configured: bool
    source: Literal["database", "env", "none"]
    owner_whatsapp: str


class NotificationLog(BaseModel):
    kind: str
    source: str
    target: str
    status: bool
    reason: str = ""
    created_at: datetime


class MorningSummary(BaseModel):
    date: str
    text: str
    due_debts: int
    due_total: float
    expiring: int
    out_of_stock: int
    low_stock: int
