import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from lib.auth import audit, require_admin
from lib.db import db
from lib.stores import current_store_id
from models.schemas import Purchase, PurchaseIn, Supplier, SupplierIn
from routers.products import record_movement

router = APIRouter(tags=["purchases"])


# ---------- suppliers ----------
@router.get("/suppliers", response_model=list[Supplier])
async def list_suppliers(_: dict = Depends(require_admin)):
    sups = await db.suppliers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    stats = {s["_id"]: s async for s in db.purchases.aggregate(
        [{"$group": {"_id": "$supplier_id", "n": {"$sum": 1}, "t": {"$sum": "$total"}}}])}
    return [Supplier(**s, purchase_count=stats.get(s["id"], {}).get("n", 0),
                     purchase_total=stats.get(s["id"], {}).get("t", 0)) for s in sups]


@router.post("/suppliers", response_model=Supplier)
async def create_supplier(body: SupplierIn, admin: dict = Depends(require_admin)):
    if await db.suppliers.find_one({"name": {"$regex": f"^{re.escape(body.name)}$", "$options": "i"}}):
        raise HTTPException(409, "Supplier sudah ada")
    sup = Supplier(**body.model_dump())
    await db.suppliers.insert_one(sup.model_dump(exclude={"purchase_count", "purchase_total"}))
    await audit(admin, "supplier_create", sup.name)
    return sup


@router.put("/suppliers/{id}", response_model=Supplier)
async def update_supplier(id: str, body: SupplierIn, admin: dict = Depends(require_admin)):
    doc = await db.suppliers.find_one_and_update({"id": id}, {"$set": body.model_dump()},
                                                 projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    await db.purchases.update_many({"supplier_id": id}, {"$set": {"supplier_name": body.name}})
    await audit(admin, "supplier_update", body.name)
    return Supplier(**doc)


@router.delete("/suppliers/{id}")
async def delete_supplier(id: str, admin: dict = Depends(require_admin)):
    if await db.purchases.count_documents({"supplier_id": id}):
        raise HTTPException(400, "Supplier memiliki riwayat pembelian, tidak bisa dihapus")
    res = await db.suppliers.delete_one({"id": id})
    if not res.deleted_count:
        raise HTTPException(404, "Supplier tidak ditemukan")
    await audit(admin, "supplier_delete", id)
    return {"success": True, "message": "Supplier dihapus"}


# ---------- purchases ----------
@router.get("/purchases", response_model=list[Purchase])
async def list_purchases(supplier_id: str = "", start: str = "", end: str = "", _: dict = Depends(require_admin)):
    query: dict = {}
    if supplier_id:
        query["supplier_id"] = supplier_id
    if start or end:
        query["date"] = {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}
    return await db.purchases.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(1000)


@router.post("/purchases", response_model=Purchase)
async def create_purchase(body: PurchaseIn, admin: dict = Depends(require_admin)):
    sup = await db.suppliers.find_one({"id": body.supplier_id})
    if not sup:
        raise HTTPException(400, "Supplier tidak valid")
    if await db.purchases.find_one({"supplier_id": body.supplier_id, "invoice_no": body.invoice_no}):
        raise HTTPException(409, "Nomor invoice sudah tercatat untuk supplier ini")
    ids = list({i.product_id for i in body.items})
    products = {p["id"]: p async for p in db.products.find({"id": {"$in": ids}}, {"_id": 0})}
    if len(products) != len(ids):
        raise HTTPException(400, "Ada produk yang tidak ditemukan")

    items = [{"product_id": i.product_id, "name": products[i.product_id]["name"],
              "unit": products[i.product_id].get("unit", "pcs"), "qty": i.qty, "buy_price": i.buy_price,
              "subtotal": i.qty * i.buy_price} for i in body.items]
    now = datetime.now(timezone.utc)
    purchase = Purchase(id=str(uuid.uuid4()), supplier_id=sup["id"], supplier_name=sup["name"],
                        invoice_no=body.invoice_no, date=body.date, items=items,
                        total=sum(i["subtotal"] for i in items), note=body.note,
                        username=admin["username"], created_at=now)
    await db.purchases.insert_one({**purchase.model_dump(), "store_id": current_store_id(admin)})
    batches = [{"id": str(uuid.uuid4()), "product_id": i.product_id, "product_name": products[i.product_id]["name"],
                "purchase_id": purchase.id, "invoice_no": body.invoice_no, "supplier_name": sup["name"],
                "expiry_date": i.expiry_date, "qty": i.qty, "dismissed": False, "created_at": now}
               for i in body.items if i.expiry_date]
    if batches:
        await db.product_batches.insert_many(batches)

    for it in items:
        update: dict = {"$inc": {"stock": it["qty"]}, "$set": {"updated_at": now, "supplier": sup["name"]}}
        old = products[it["product_id"]]
        if body.update_buy_price and old["buy_price"] != it["buy_price"]:
            update["$set"]["buy_price"] = it["buy_price"]
            await db.price_history.insert_one({
                "product_id": old["id"], "old_buy": old["buy_price"], "new_buy": it["buy_price"],
                "old_sell": old["sell_price"], "new_sell": old["sell_price"],
                "username": admin["username"], "created_at": now})
        p = await db.products.find_one_and_update({"id": it["product_id"]}, update,
                                                  return_document=ReturnDocument.AFTER)
        await record_movement(p, "purchase", it["qty"], p["stock"] - it["qty"], p["stock"], admin,
                              f"Pembelian {body.invoice_no} ({sup['name']})")
    await audit(admin, "purchase", f"{body.invoice_no} {sup['name']} total {purchase.total:g}")
    return purchase



@router.get("/batches/expiring")
async def expiring_batches(_: dict = Depends(require_admin)):
    from routers.dashboard import expiring_list
    return await expiring_list()


@router.post("/batches/{id}/dismiss")
async def dismiss_batch(id: str, admin: dict = Depends(require_admin)):
    r = await db.product_batches.update_one({"id": id}, {"$set": {"dismissed": True}})
    if not r.matched_count:
        raise HTTPException(404, "Batch tidak ditemukan")
    await audit(admin, "batch_dismiss", id)
    return {"success": True, "message": "Peringatan kedaluwarsa ditandai selesai"}
