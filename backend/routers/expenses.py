from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, require_admin
from lib.db import db
from models.schemas import Expense, ExpenseIn

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[Expense])
async def list_expenses(start: str = "", end: str = "", category: str = "", _: dict = Depends(require_admin)):
    q: dict = {}
    if start or end:
        q["date"] = {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}
    if category:
        q["category"] = category
    return await db.expenses.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(2000)


@router.post("", response_model=Expense)
async def create_expense(body: ExpenseIn, admin: dict = Depends(require_admin)):
    e = Expense(**body.model_dump(), username=admin["username"])
    await db.expenses.insert_one(e.model_dump())
    await audit(admin, "expense_create", f"{e.category} {e.amount:g}")
    return e


@router.put("/{id}", response_model=Expense)
async def update_expense(id: str, body: ExpenseIn, admin: dict = Depends(require_admin)):
    doc = await db.expenses.find_one_and_update({"id": id}, {"$set": body.model_dump()}, projection={"_id": 0},
                                                return_document=True)
    if not doc:
        raise HTTPException(404, "Pengeluaran tidak ditemukan")
    await audit(admin, "expense_update", f"{body.category} {body.amount:g}")
    return Expense(**doc)


@router.delete("/{id}")
async def delete_expense(id: str, admin: dict = Depends(require_admin)):
    doc = await db.expenses.find_one_and_delete({"id": id})
    if not doc:
        raise HTTPException(404, "Pengeluaran tidak ditemukan")
    await audit(admin, "expense_delete", f"{doc['category']} {doc['amount']:g}")
    return {"success": True, "message": "Pengeluaran dihapus"}
