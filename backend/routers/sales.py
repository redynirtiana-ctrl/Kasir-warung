import os
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from lib.auth import audit, get_current_user, require_admin
from lib.db import db
from lib.pricing import effective_price
from models.schemas import Sale, SaleIn, Settings, VoidIn
from routers.products import record_movement

router = APIRouter(tags=["sales"])


def store_tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("STORE_TZ", "Asia/Jakarta"))


async def get_settings() -> Settings:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "key": 0})
    return Settings(**(doc or {}))


async def next_invoice_no(prefix: str, date_str: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"key": f"invoice-{date_str}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return f"{prefix}-{date_str.replace('-', '')}-{counter['seq']:04d}"


@router.post("/sales", response_model=Sale)
async def create_sale(body: SaleIn, user: dict = Depends(get_current_user)):
    settings = await get_settings()
    if body.payment_method not in settings.payment_methods:
        raise HTTPException(400, "Metode pembayaran tidak aktif")
    # Merge duplicate lines, then load products.
    merged: dict[str, dict] = {}
    for it in body.items:
        m = merged.setdefault(it.product_id, {"qty": 0.0, "discount": 0.0})
        m["qty"] += it.qty
        m["discount"] += it.discount
    products = {p["id"]: p async for p in db.products.find({"id": {"$in": list(merged)}}, {"_id": 0})}
    today = datetime.now(store_tz()).strftime("%Y-%m-%d")
    items = []
    for pid, m in merged.items():
        p = products.get(pid)
        if not p or not p.get("active", True):
            raise HTTPException(400, "Produk tidak ditemukan / nonaktif")
        if p["stock"] < m["qty"]:
            raise HTTPException(400, f"Stok {p['name']} tidak cukup (sisa {p['stock']:g})")
        unit_price, price_type = effective_price(p, m["qty"], today)
        gross = unit_price * m["qty"]
        disc = min(m["discount"], gross)
        items.append({"product_id": pid, "name": p["name"], "unit": p.get("unit", "pcs"), "qty": m["qty"],
                      "price": unit_price, "buy_price": p["buy_price"], "discount": disc,
                      "subtotal": gross - disc, "normal_price": p["sell_price"], "price_type": price_type})
    subtotal = sum(i["subtotal"] for i in items)
    discount = subtotal * body.discount_value / 100 if body.discount_type == "percent" else body.discount_value
    discount = round(min(discount, subtotal))
    customer = None
    if body.customer_id:
        customer = await db.customers.find_one({"id": body.customer_id}, {"_id": 0})
        if not customer:
            raise HTTPException(400, "Pelanggan tidak ditemukan")
    # Loyalty: redeem points as extra discount (capped so the bill never goes below zero).
    redeem, points_discount = 0, 0.0
    if body.redeem_points:
        if not settings.loyalty_enabled or not customer:
            raise HTTPException(400, "Tukar poin butuh pelanggan & fitur poin aktif")
        if body.redeem_points < settings.min_redeem_points:
            raise HTTPException(400, f"Minimal tukar {settings.min_redeem_points} poin")
        if body.redeem_points > customer.get("points", 0):
            raise HTTPException(400, "Poin pelanggan tidak cukup")
        max_pts = int((subtotal - discount) // settings.point_value) if settings.point_value else 0
        redeem = min(body.redeem_points, max_pts)
        points_discount = redeem * settings.point_value
        discount += points_discount
    tax = round((subtotal - discount) * settings.tax_percent / 100)
    total = subtotal - discount + tax
    if body.payment_method == "cash" and body.amount_paid < total:
        raise HTTPException(400, "Uang diterima kurang dari total")
    earned = int(total // settings.points_per_amount) if settings.loyalty_enabled and customer else 0
    if body.payment_method == "hutang":
        if not customer:
            raise HTTPException(400, "Pilih pelanggan untuk transaksi hutang")
        if body.amount_paid >= total:
            raise HTTPException(400, "DP tidak boleh sama/lebih dari total, gunakan metode lain")
        paid = body.amount_paid  # down payment (cash) — rest becomes debt
    else:
        paid = body.amount_paid if body.payment_method == "cash" else max(body.amount_paid, total)

    # Atomic conditional decrement per product; roll back on any failure (Mongo standalone has no txns).
    done: list[tuple[str, float]] = []
    for it in items:
        res = await db.products.find_one_and_update(
            {"id": it["product_id"], "stock": {"$gte": it["qty"]}}, {"$inc": {"stock": -it["qty"]}},
            return_document=ReturnDocument.AFTER)
        if not res:
            for pid, q in done:
                await db.products.update_one({"id": pid}, {"$inc": {"stock": q}})
            raise HTTPException(409, f"Stok {it['name']} berubah, silakan ulangi")
        done.append((it["product_id"], it["qty"]))
        it["_after"] = res["stock"]

    if redeem:
        ok = await db.customers.find_one_and_update({"id": customer["id"], "points": {"$gte": redeem}}, {"$inc": {"points": -redeem}})
        if not ok:
            for pid, q in done:
                await db.products.update_one({"id": pid}, {"$inc": {"stock": q}})
            raise HTTPException(409, "Poin pelanggan berubah, silakan ulangi")
    if earned:
        await db.customers.update_one({"id": customer["id"]}, {"$inc": {"points": earned}})
    now = datetime.now(timezone.utc)
    date_str = now.astimezone(store_tz()).strftime("%Y-%m-%d")
    invoice = await next_invoice_no(settings.invoice_prefix, date_str)
    for it in items:
        after = it.pop("_after")
        await record_movement(products[it["product_id"]], "sale", -it["qty"], after + it["qty"], after, user, invoice)
    sale = Sale(id=str(uuid.uuid4()), invoice_no=invoice, items=items, subtotal=subtotal, discount=discount,
                tax=tax, total=total, payment_method=body.payment_method, amount_paid=paid,
                change=max(paid - total, 0), cashier_name=user["full_name"], status="completed",
                customer_id=customer["id"] if customer else None, customer_name=customer["name"] if customer else None,
                points_earned=earned, points_redeemed=redeem, points_discount=points_discount,
                date=date_str, created_at=now)
    await db.sales.insert_one({**sale.model_dump(), "cashier_id": user["id"]})
    if body.payment_method == "hutang":
        from routers.customers import create_debt
        await create_debt(sale.model_dump(), customer, body.due_date)
    await audit(user, "sale", f"{invoice} total {total:g}")
    return sale


@router.get("/sales", response_model=list[Sale])
async def list_sales(start: str = "", end: str = "", q: str = "", _: dict = Depends(get_current_user)):
    query: dict = {}
    if start or end:
        query["date"] = {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}
    if q:
        query["invoice_no"] = {"$regex": q, "$options": "i"}
    return await db.sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.get("/sales/{id}", response_model=Sale)
async def get_sale(id: str, _: dict = Depends(get_current_user)):
    doc = await db.sales.find_one({"id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Transaksi tidak ditemukan")
    return Sale(**doc)


@router.post("/sales/{id}/void", response_model=Sale)
async def void_sale(id: str, body: VoidIn, admin: dict = Depends(require_admin)):
    doc = await db.sales.find_one_and_update({"id": id, "status": "completed"},
                                             {"$set": {"status": "void", "void_reason": body.reason,
                                                       "voided_by": admin["username"],
                                                       "voided_at": datetime.now(timezone.utc)}},
                                             projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not doc:
        raise HTTPException(404, "Transaksi tidak ditemukan atau sudah void")
    for it in doc["items"]:
        p = await db.products.find_one_and_update({"id": it["product_id"]}, {"$inc": {"stock": it["qty"]}},
                                                  return_document=ReturnDocument.AFTER)
        if p:
            await record_movement(p, "return", it["qty"], p["stock"] - it["qty"], p["stock"], admin,
                                  f"Void {doc['invoice_no']}")
    if doc.get("customer_id") and (doc.get("points_earned") or doc.get("points_redeemed")):
        await db.customers.update_one({"id": doc["customer_id"]},
                                      {"$inc": {"points": doc.get("points_redeemed", 0) - doc.get("points_earned", 0)}})
    await audit(admin, "sale_void", f"{doc['invoice_no']}: {body.reason}")
    return Sale(**doc)


@router.get("/settings", response_model=Settings)
async def read_settings(_: dict = Depends(get_current_user)):
    return await get_settings()


@router.put("/settings", response_model=Settings)
async def update_settings(body: Settings, admin: dict = Depends(require_admin)):
    await db.settings.update_one({"key": "store"}, {"$set": body.model_dump()}, upsert=True)
    await audit(admin, "settings_update")
    return body
