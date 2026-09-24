import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, get_current_user
from lib.db import db
from models.schemas import Shift, ShiftCloseIn, ShiftExpenseIn, ShiftOpenIn, ShiftSummary

router = APIRouter(prefix="/shifts", tags=["shifts"])


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def compute_summary(shift: dict, until: datetime | None = None) -> ShiftSummary:
    q = {"cashier_id": shift["user_id"], "status": "completed", "created_at": {"$gte": _aware(shift["opened_at"])}}
    if until:
        q["created_at"]["$lte"] = until
    sales = await db.sales.find(q, {"_id": 0, "total": 1, "payment_method": 1, "id": 1}).to_list(10000)
    by_payment: dict[str, float] = {}
    for s in sales:
        by_payment[s["payment_method"]] = by_payment.get(s["payment_method"], 0) + s["total"]
    # cash refunds for sale returns processed during this shift on this cashier's sales
    sale_ids = [s["id"] for s in sales]
    refunds = 0.0
    if sale_ids:
        cash_ids = {s["id"] for s in sales if s["payment_method"] == "cash"}
        async for r in db.returns.find({"type": "sale", "ref_id": {"$in": list(cash_ids)}}, {"total": 1}):
            refunds += r["total"]
    expenses = sum(e["amount"] for e in shift.get("expenses", []))
    expected = shift["opening_cash"] + by_payment.get("cash", 0) - expenses - refunds
    return ShiftSummary(transaction_count=len(sales), total_sales=sum(s["total"] for s in sales),
                        by_payment=by_payment, expenses_total=expenses, refunds_cash=refunds, expected_cash=expected)


async def _open_shift(user: dict) -> dict | None:
    return await db.shifts.find_one({"user_id": user["id"], "status": "open"}, {"_id": 0})


@router.get("/current", response_model=Shift | None)
async def current_shift(user: dict = Depends(get_current_user)):
    s = await _open_shift(user)
    if not s:
        return None
    return Shift(**{**s, "summary": await compute_summary(s)})


@router.post("/open", response_model=Shift)
async def open_shift(body: ShiftOpenIn, user: dict = Depends(get_current_user)):
    if await _open_shift(user):
        raise HTTPException(400, "Shift masih terbuka. Tutup shift dulu.")
    s = Shift(id=str(uuid.uuid4()), user_id=user["id"], cashier_name=user["full_name"], status="open",
              opening_cash=body.opening_cash, opened_at=datetime.now(timezone.utc))
    await db.shifts.insert_one(s.model_dump())
    await audit(user, "shift_open", f"modal {body.opening_cash:g}")
    return s


@router.post("/current/expenses", response_model=Shift)
async def add_expense(body: ShiftExpenseIn, user: dict = Depends(get_current_user)):
    s = await _open_shift(user)
    if not s:
        raise HTTPException(400, "Belum ada shift terbuka")
    exp = {"amount": body.amount, "note": body.note, "created_at": datetime.now(timezone.utc)}
    await db.shifts.update_one({"id": s["id"]}, {"$push": {"expenses": exp}})
    s["expenses"] = [*s.get("expenses", []), exp]
    await audit(user, "shift_expense", f"{body.amount:g} {body.note}")
    return Shift(**{**s, "summary": await compute_summary(s)})


@router.post("/close", response_model=Shift)
async def close_shift(body: ShiftCloseIn, user: dict = Depends(get_current_user)):
    s = await _open_shift(user)
    if not s:
        raise HTTPException(400, "Belum ada shift terbuka")
    now = datetime.now(timezone.utc)
    summary = await compute_summary(s, now)
    update = {"status": "closed", "closed_at": now, "summary": summary.model_dump(), "actual_cash": body.actual_cash,
              "difference": body.actual_cash - summary.expected_cash, "note": body.note}
    await db.shifts.update_one({"id": s["id"]}, {"$set": update})
    await audit(user, "shift_close", f"selisih {update['difference']:g}")
    return Shift(**{**s, **update})


@router.get("", response_model=list[Shift])
async def list_shifts(user: dict = Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"user_id": user["id"]}
    return await db.shifts.find(q, {"_id": 0}).sort("opened_at", -1).to_list(200)
