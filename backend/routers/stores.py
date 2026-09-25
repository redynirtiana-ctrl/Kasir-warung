"""Toko / cabang management (foundation for multi-cabang)."""

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, get_current_user, require_admin
from lib.db import db
from lib.stores import MAIN_STORE_ID, TAGGED_COLLECTIONS
from models.schemas import Store, StoreIn

router = APIRouter(tags=["stores"])


async def _with_stats(doc: dict) -> Store:
    sid = doc["id"]
    agg = await db.sales.aggregate([{"$match": {"store_id": sid, "status": "completed"}},
                                    {"$group": {"_id": None, "n": {"$sum": 1}, "t": {"$sum": "$total"}}}]).to_list(1)
    return Store(**doc, product_count=await db.products.count_documents({"store_id": sid}),
                 sales_count=agg[0]["n"] if agg else 0, sales_total=agg[0]["t"] if agg else 0)


async def _check_code(code: str, exclude: str | None = None) -> None:
    q: dict = {"code": code.upper()}
    if exclude:
        q["id"] = {"$ne": exclude}
    if await db.stores.find_one(q):
        raise HTTPException(409, "Kode cabang sudah dipakai")


@router.get("/stores", response_model=list[Store])
async def list_stores(_: dict = Depends(get_current_user)):
    docs = await db.stores.find({}, {"_id": 0}).sort([("is_main", -1), ("name", 1)]).to_list(200)
    return [await _with_stats(d) for d in docs]


@router.post("/stores", response_model=Store)
async def create_store(body: StoreIn, admin: dict = Depends(require_admin)):
    await _check_code(body.code)
    store = Store(**{**body.model_dump(), "code": body.code.upper()})
    await db.stores.insert_one(store.model_dump(exclude={"product_count", "sales_count", "sales_total"}))
    await audit(admin, "store_create", f"{store.code} {store.name}")
    return store


@router.put("/stores/{id}", response_model=Store)
async def update_store(id: str, body: StoreIn, admin: dict = Depends(require_admin)):
    doc = await db.stores.find_one({"id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Cabang tidak ditemukan")
    if doc.get("is_main") and not body.active:
        raise HTTPException(400, "Cabang utama tidak dapat dinonaktifkan")
    await _check_code(body.code, id)
    upd = {**body.model_dump(), "code": body.code.upper()}
    await db.stores.update_one({"id": id}, {"$set": upd})
    await audit(admin, "store_update", f"{upd['code']} {body.name}")
    return await _with_stats({**doc, **upd})


@router.delete("/stores/{id}")
async def delete_store(id: str, admin: dict = Depends(require_admin)):
    if id == MAIN_STORE_ID:
        raise HTTPException(400, "Cabang utama tidak dapat dihapus")
    doc = await db.stores.find_one({"id": id})
    if not doc:
        raise HTTPException(404, "Cabang tidak ditemukan")
    for coll in TAGGED_COLLECTIONS:
        if await db[coll].find_one({"store_id": id}):
            raise HTTPException(409, "Cabang sudah memiliki data — nonaktifkan saja")
    await db.stores.delete_one({"id": id})
    await audit(admin, "store_delete", doc["name"])
    return {"success": True, "message": "Cabang dihapus"}
