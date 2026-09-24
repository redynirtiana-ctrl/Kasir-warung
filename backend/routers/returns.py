import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from lib.auth import audit, require_admin
from lib.db import db
from models.schemas import Return, ReturnIn
from routers.products import record_movement
from routers.sales import store_tz

router = APIRouter(tags=["returns"])


async def _returned_qty(ref_id: str) -> dict[str, float]:
    out: dict[str, float] = {}
    async for r in db.returns.find({"ref_id": ref_id}, {"items": 1}):
        for i in r["items"]:
            out[i["product_id"]] = out.get(i["product_id"], 0) + i["qty"]
    return out


@router.get("/returns", response_model=list[Return])
async def list_returns(type: str = "", ref_id: str = "", _: dict = Depends(require_admin)):
    q: dict = {}
    if type:
        q["type"] = type
    if ref_id:
        q["ref_id"] = ref_id
    return await db.returns.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.get("/returns/returned/{ref_id}")
async def returned_qty(ref_id: str, _: dict = Depends(require_admin)) -> dict[str, float]:
    return await _returned_qty(ref_id)


@router.post("/returns", response_model=Return)
async def create_return(body: ReturnIn, admin: dict = Depends(require_admin)):
    if body.type == "sale":
        ref = await db.sales.find_one({"id": body.ref_id}, {"_id": 0})
        if not ref or ref["status"] != "completed":
            raise HTTPException(400, "Transaksi tidak ditemukan atau sudah void")
        ref_no = ref["invoice_no"]
        # unit refund price = line subtotal / qty (includes per-line discount)
        lines = {i["product_id"]: (i["qty"], i["subtotal"] / i["qty"], i["name"]) for i in ref["items"]}
    else:
        ref = await db.purchases.find_one({"id": body.ref_id}, {"_id": 0})
        if not ref:
            raise HTTPException(400, "Pembelian tidak ditemukan")
        ref_no = ref["invoice_no"]
        lines = {i["product_id"]: (i["qty"], i["buy_price"], i["name"]) for i in ref["items"]}

    done = await _returned_qty(body.ref_id)
    merged: dict[str, float] = {}
    for it in body.items:
        merged[it.product_id] = merged.get(it.product_id, 0) + it.qty
    items = []
    for pid, qty in merged.items():
        if pid not in lines:
            raise HTTPException(400, "Produk tidak ada di transaksi asal")
        orig_qty, price, name = lines[pid]
        remaining = orig_qty - done.get(pid, 0)
        if qty > remaining + 1e-9:
            raise HTTPException(400, f"Qty retur {name} melebihi sisa ({remaining:g})")
        items.append({"product_id": pid, "name": name, "qty": qty, "price": round(price, 2),
                      "subtotal": round(price * qty, 2)})

    sign = 1 if body.type == "sale" else -1
    applied: list[tuple[str, float]] = []
    for it in items:
        cond = {"id": it["product_id"]} if sign > 0 else {"id": it["product_id"], "stock": {"$gte": it["qty"]}}
        p = await db.products.find_one_and_update(cond, {"$inc": {"stock": sign * it["qty"]}},
                                                  return_document=ReturnDocument.AFTER)
        if not p:
            for pid, q in applied:
                await db.products.update_one({"id": pid}, {"$inc": {"stock": -sign * q}})
            raise HTTPException(400, f"Stok {it['name']} tidak cukup untuk retur pembelian")
        applied.append((it["product_id"], it["qty"]))
        it["_p"] = p

    now = datetime.now(timezone.utc)
    date_str = now.astimezone(store_tz()).strftime("%Y-%m-%d")
    counter = await db.counters.find_one_and_update({"key": f"return-{date_str}"}, {"$inc": {"seq": 1}},
                                                    upsert=True, return_document=ReturnDocument.AFTER)
    return_no = f"RTR-{date_str.replace('-', '')}-{counter['seq']:04d}"
    for it in items:
        p = it.pop("_p")
        await record_movement(p, "return", sign * it["qty"], p["stock"] - sign * it["qty"], p["stock"], admin,
                              f"Retur {'penjualan' if sign > 0 else 'pembelian'} {ref_no}: {body.reason}")
    ret = Return(id=str(uuid.uuid4()), return_no=return_no, type=body.type, ref_id=body.ref_id, ref_no=ref_no,
                 items=items, total=sum(i["subtotal"] for i in items), reason=body.reason,
                 username=admin["username"], date=date_str, created_at=now)
    await db.returns.insert_one(ret.model_dump())
    await audit(admin, f"return_{body.type}", f"{return_no} ref {ref_no} total {ret.total:g}")
    return ret
