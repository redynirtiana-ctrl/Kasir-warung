import re

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, get_current_user, require_admin
from lib.db import db
from models.schemas import Category, CategoryIn

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[Category])
async def list_categories(_: dict = Depends(get_current_user)):
    cats = await db.categories.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    counts = {c["_id"]: c["n"] async for c in db.products.aggregate(
        [{"$group": {"_id": "$category_id", "n": {"$sum": 1}}}])}
    return [Category(**c, product_count=counts.get(c["id"], 0)) for c in cats]


@router.post("", response_model=Category)
async def create_category(body: CategoryIn, admin: dict = Depends(require_admin)):
    if await db.categories.find_one({"name": {"$regex": f"^{re.escape(body.name)}$", "$options": "i"}}):
        raise HTTPException(409, "Kategori sudah ada")
    cat = Category(**body.model_dump())
    await db.categories.insert_one(cat.model_dump(exclude={"product_count"}))
    await audit(admin, "category_create", cat.name)
    return cat


@router.put("/{id}", response_model=Category)
async def update_category(id: str, body: CategoryIn, admin: dict = Depends(require_admin)):
    doc = await db.categories.find_one_and_update({"id": id}, {"$set": body.model_dump()},
                                                  projection={"_id": 0}, return_document=True)
    if not doc:
        raise HTTPException(404, "Kategori tidak ditemukan")
    await db.products.update_many({"category_id": id}, {"$set": {"category_name": body.name}})
    await audit(admin, "category_update", body.name)
    return Category(**doc)


@router.delete("/{id}")
async def delete_category(id: str, admin: dict = Depends(require_admin)):
    if await db.products.count_documents({"category_id": id}):
        raise HTTPException(400, "Kategori masih dipakai produk")
    res = await db.categories.delete_one({"id": id})
    if not res.deleted_count:
        raise HTTPException(404, "Kategori tidak ditemukan")
    await audit(admin, "category_delete", id)
    return {"success": True, "message": "Kategori dihapus"}
