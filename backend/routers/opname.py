"""Stock opname: compare physical count vs system stock and adjust all differences at once."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, require_admin
from lib.db import db
from models.schemas import Opname, OpnameIn, OpnameLine
from routers.products import record_movement

router = APIRouter(prefix="/stock/opname", tags=["opname"])


@router.get("", response_model=list[Opname])
async def list_opname(_: dict = Depends(require_admin)):
    return await db.stock_opnames.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("", response_model=Opname)
async def commit_opname(body: OpnameIn, admin: dict = Depends(require_admin)):
    counted = {i.product_id: i.counted for i in body.items}
    products = {p["id"]: p async for p in db.products.find({"id": {"$in": list(counted)}}, {"_id": 0})}
    if len(products) != len(counted):
        raise HTTPException(400, "Ada produk yang tidak ditemukan")
    lines: list[OpnameLine] = []
    note = body.note or "Stok opname"
    for pid, c in counted.items():
        p = products[pid]
        # re-read inside the loop so sales made during counting are respected
        cur = await db.products.find_one_and_update({"id": pid}, {"$set": {"stock": c, "updated_at": datetime.now(timezone.utc)}},
                                                    projection={"_id": 0, "stock": 1})
        before = cur["stock"]
        diff = c - before
        if diff:
            await record_movement(p, "opname", diff, before, c, admin, note)
        lines.append(OpnameLine(product_id=pid, sku=p["sku"], name=p["name"], system_stock=before, counted=c,
                                diff=diff, value_diff=diff * p["buy_price"]))
    op = Opname(id=str(uuid.uuid4()), lines=lines, adjusted_count=sum(1 for ln in lines if ln.diff),
                value_diff=sum(ln.value_diff for ln in lines), note=note, username=admin["username"],
                created_at=datetime.now(timezone.utc))
    await db.stock_opnames.insert_one(op.model_dump())
    await audit(admin, "stock_opname", f"{op.adjusted_count} produk disesuaikan, selisih nilai {op.value_diff:g}")
    return op
