import random
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, get_current_user, require_admin
from lib.db import db
from lib.stores import current_store_id
from models.schemas import Product, ProductIn, StockAdjustIn, StockMovement

router = APIRouter(tags=["products"])


async def _category_name(category_id: str | None) -> str | None:
    if not category_id:
        return None
    cat = await db.categories.find_one({"id": category_id})
    if not cat:
        raise HTTPException(400, "Kategori tidak valid")
    return cat["name"]


async def _check_unique(body: ProductIn, exclude_id: str | None = None) -> None:
    ne = {"id": {"$ne": exclude_id}} if exclude_id else {}
    if await db.products.find_one({"sku": body.sku, **ne}):
        raise HTTPException(409, "SKU sudah dipakai produk lain")
    if body.barcode and await db.products.find_one({"barcode": body.barcode, **ne}):
        raise HTTPException(409, "Barcode sudah dipakai produk lain")


async def generate_unique_barcode() -> str:
    """Internal CODE128-friendly 13-digit code with store prefix 200 (in-store range)."""
    while True:
        code = "200" + "".join(random.choices("0123456789", k=10))
        if not await db.products.find_one({"barcode": code}):
            return code


async def record_movement(product: dict, type_: str, qty: float, before: float, after: float,
                          user: dict, note: str = "") -> None:
    import uuid
    await db.stock_movements.insert_one({
        "id": str(uuid.uuid4()), "product_id": product["id"], "product_name": product["name"],
        "type": type_, "qty": qty, "stock_before": before, "stock_after": after,
        "user_id": user["id"], "username": user["username"], "note": note,
        "store_id": current_store_id(user),  # branch of the user who moved the stock
        "created_at": datetime.now(timezone.utc),
    })


@router.get("/products", response_model=list[Product])
async def list_products(q: str = "", category_id: str = "", active_only: bool = False,
                        _: dict = Depends(get_current_user)):
    query: dict = {}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"name": rx}, {"sku": rx}, {"barcode": rx}, {"category_name": rx}]
    if category_id:
        query["category_id"] = category_id
    if active_only:
        query["active"] = True
    return await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(2000)


@router.get("/products/barcode/{barcode}", response_model=Product)
async def get_by_barcode(barcode: str, _: dict = Depends(get_current_user)):
    bc = barcode.strip()
    doc = await db.products.find_one({"$or": [{"barcode": bc}, {"units.barcode": bc}]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Produk dengan barcode tersebut belum terdaftar.")
    return Product(**doc)


@router.get("/barcode/generate")
async def generate_barcode(_: dict = Depends(require_admin)):
    return {"barcode": await generate_unique_barcode()}


@router.post("/products", response_model=Product)
async def create_product(body: ProductIn, admin: dict = Depends(require_admin)):
    if not body.barcode:
        body.barcode = await generate_unique_barcode()
    await _check_unique(body)
    product = Product(**body.model_dump(), category_name=await _category_name(body.category_id),
                      store_id=current_store_id(admin))
    await db.products.insert_one(product.model_dump())
    if product.stock:
        await record_movement(product.model_dump(), "stock_in", product.stock, 0, product.stock, admin, "Stok awal")
    await audit(admin, "product_create", product.name)
    return product


@router.put("/products/{id}", response_model=Product)
async def update_product(id: str, body: ProductIn, admin: dict = Depends(require_admin)):
    old = await db.products.find_one({"id": id}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Produk tidak ditemukan")
    if not body.barcode:
        body.barcode = old.get("barcode") or await generate_unique_barcode()
    await _check_unique(body, exclude_id=id)
    update = {**body.model_dump(), "category_name": await _category_name(body.category_id),
              "updated_at": datetime.now(timezone.utc)}
    await db.products.update_one({"id": id}, {"$set": update})
    new = {**old, **update}
    if old["stock"] != body.stock:
        await record_movement(new, "adjustment", body.stock - old["stock"], old["stock"], body.stock, admin, "Edit produk")
    if old["buy_price"] != body.buy_price or old["sell_price"] != body.sell_price:
        await db.price_history.insert_one({
            "product_id": id, "old_buy": old["buy_price"], "new_buy": body.buy_price,
            "old_sell": old["sell_price"], "new_sell": body.sell_price,
            "username": admin["username"], "created_at": datetime.now(timezone.utc)})
        await audit(admin, "price_change", f"{body.name}: {old['sell_price']} -> {body.sell_price}")
    await audit(admin, "product_update", body.name)
    return Product(**new)


@router.delete("/products/{id}")
async def delete_product(id: str, admin: dict = Depends(require_admin)):
    doc = await db.products.find_one_and_delete({"id": id})
    if not doc:
        raise HTTPException(404, "Produk tidak ditemukan")
    await audit(admin, "product_delete", doc["name"])
    return {"success": True, "message": "Produk dihapus"}


@router.post("/stock/adjustment", response_model=Product)
async def stock_adjustment(body: StockAdjustIn, admin: dict = Depends(require_admin)):
    doc = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Produk tidak ditemukan")
    before = doc["stock"]
    after = {"stock_in": before + body.qty, "stock_out": before - body.qty, "adjustment": body.qty}[body.type]
    if after < 0:
        raise HTTPException(400, "Stok tidak boleh negatif")
    await db.products.update_one({"id": doc["id"]}, {"$set": {"stock": after, "updated_at": datetime.now(timezone.utc)}})
    await record_movement(doc, body.type, after - before, before, after, admin, body.note)
    await audit(admin, "stock_adjustment", f"{doc['name']}: {before} -> {after}")
    return Product(**{**doc, "stock": after})


@router.get("/stock/movements", response_model=list[StockMovement])
async def stock_movements(product_id: str = "", _: dict = Depends(get_current_user)):
    query = {"product_id": product_id} if product_id else {}
    return await db.stock_movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
