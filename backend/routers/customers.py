import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from lib.auth import audit, get_current_user, require_admin
from lib.db import db
from models.schemas import Customer, CustomerIn, Debt, DebtPaymentIn, Sale

router = APIRouter(tags=["customers"])


# ---------- customers (kasir may read/create so they can pick at checkout) ----------
@router.get("/customers", response_model=list[Customer])
async def list_customers(q: str = "", _: dict = Depends(get_current_user)):
    query = {"name": {"$regex": re.escape(q), "$options": "i"}} if q else {}
    custs = await db.customers.find(query, {"_id": 0}).sort("name", 1).to_list(2000)
    debts = {d["_id"]: d["r"] async for d in db.debts.aggregate(
        [{"$match": {"status": "open"}}, {"$group": {"_id": "$customer_id", "r": {"$sum": "$remaining"}}}])}
    trx = {d["_id"]: d["n"] async for d in db.sales.aggregate(
        [{"$match": {"customer_id": {"$ne": None}, "status": "completed"}}, {"$group": {"_id": "$customer_id", "n": {"$sum": 1}}}])}
    return [Customer(**c, debt_remaining=debts.get(c["id"], 0), transaction_count=trx.get(c["id"], 0)) for c in custs]


@router.post("/customers", response_model=Customer)
async def create_customer(body: CustomerIn, user: dict = Depends(get_current_user)):
    c = Customer(**body.model_dump())
    await db.customers.insert_one(c.model_dump(exclude={"debt_remaining", "transaction_count"}))
    await audit(user, "customer_create", c.name)
    return c


@router.put("/customers/{id}", response_model=Customer)
async def update_customer(id: str, body: CustomerIn, admin: dict = Depends(require_admin)):
    doc = await db.customers.find_one_and_update({"id": id}, {"$set": body.model_dump()}, projection={"_id": 0},
                                                 return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    await db.debts.update_many({"customer_id": id}, {"$set": {"customer_name": body.name}})
    await audit(admin, "customer_update", body.name)
    return Customer(**doc)


@router.delete("/customers/{id}")
async def delete_customer(id: str, admin: dict = Depends(require_admin)):
    if await db.debts.count_documents({"customer_id": id, "status": "open"}):
        raise HTTPException(400, "Pelanggan masih punya hutang")
    res = await db.customers.delete_one({"id": id})
    if not res.deleted_count:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    await audit(admin, "customer_delete", id)
    return {"success": True, "message": "Pelanggan dihapus"}


@router.get("/customers/{id}/sales", response_model=list[Sale])
async def customer_sales(id: str, _: dict = Depends(get_current_user)):
    return await db.sales.find({"customer_id": id}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------- debts (piutang) ----------
async def create_debt(sale: dict, customer: dict, due_date: str | None) -> None:
    total, paid = sale["total"], sale["amount_paid"]
    await db.debts.insert_one({
        "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
        "sale_id": sale["id"], "invoice_no": sale["invoice_no"], "total": total, "paid": paid,
        "remaining": total - paid, "due_date": due_date, "status": "open" if total - paid > 0 else "paid",
        "payments": [], "created_at": sale["created_at"]})


@router.get("/debts", response_model=list[Debt])
async def list_debts(status: str = "", customer_id: str = "", _: dict = Depends(require_admin)):
    q: dict = {}
    if status:
        q["status"] = status
    if customer_id:
        q["customer_id"] = customer_id
    return await db.debts.find(q, {"_id": 0}).sort([("status", -1), ("due_date", 1)]).to_list(2000)


@router.post("/debts/{id}/payments", response_model=Debt)
async def pay_debt(id: str, body: DebtPaymentIn, admin: dict = Depends(require_admin)):
    d = await db.debts.find_one({"id": id}, {"_id": 0})
    if not d or d["status"] != "open":
        raise HTTPException(404, "Hutang tidak ditemukan atau sudah lunas")
    if body.amount > d["remaining"] + 1e-6:
        raise HTTPException(400, f"Pembayaran melebihi sisa hutang (Rp {d['remaining']:,.0f})")
    now = datetime.now(timezone.utc)
    remaining = round(d["remaining"] - body.amount, 2)
    pay = {"amount": body.amount, "note": body.note, "username": admin["username"], "user_id": admin["id"], "created_at": now}
    doc = await db.debts.find_one_and_update(
        {"id": id, "remaining": d["remaining"]},
        {"$set": {"remaining": remaining, "paid": d["paid"] + body.amount, "status": "paid" if remaining <= 0 else "open"},
         "$push": {"payments": pay}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(409, "Data hutang berubah, ulangi")
    await audit(admin, "debt_payment", f"{d['invoice_no']} {body.amount:g}")
    return Debt(**doc)
