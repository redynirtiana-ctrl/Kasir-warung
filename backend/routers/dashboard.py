from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import get_current_user
from lib.db import db
from models.schemas import ChartPoint, Dashboard, LowStockItem, Sale
from routers.sales import store_tz

router = APIRouter(tags=["dashboard"])


def resolve_range(range_: str, start: str, end: str) -> tuple[str, str]:
    today = datetime.now(store_tz()).date()
    if range_ == "yesterday":
        d = today - timedelta(days=1)
        return d.isoformat(), d.isoformat()
    if range_ == "7d":
        return (today - timedelta(days=6)).isoformat(), today.isoformat()
    if range_ == "month":
        return today.replace(day=1).isoformat(), today.isoformat()
    if range_ == "custom":
        if not start or not end or start > end:
            raise HTTPException(422, "Tanggal custom tidak valid")
        return start, end
    return today.isoformat(), today.isoformat()


@router.get("/dashboard", response_model=Dashboard)
async def dashboard(range: str = "today", start: str = "", end: str = "", _: dict = Depends(get_current_user)):
    s, e = resolve_range(range, start, end)
    sales = await db.sales.find({"date": {"$gte": s, "$lte": e}, "status": "completed"}, {"_id": 0}).to_list(10000)
    total = sum(x["total"] for x in sales)
    items_sold = sum(i["qty"] for x in sales for i in x["items"])
    cost = sum(i["buy_price"] * i["qty"] for x in sales for i in x["items"])
    profit = sum(x["subtotal"] - x["discount"] for x in sales) - cost
    breakdown: dict[str, float] = {}
    for x in sales:
        breakdown[x["payment_method"]] = breakdown.get(x["payment_method"], 0) + x["total"]

    # Chart: daily points over the range (min 7 days so a single day still shows a trend).
    sd, ed = datetime.fromisoformat(s).date(), datetime.fromisoformat(e).date()
    if (ed - sd).days < 6:
        sd = ed - timedelta(days=6)
    chart_sales = await db.sales.find({"date": {"$gte": sd.isoformat(), "$lte": e}, "status": "completed"},
                                      {"_id": 0, "date": 1, "total": 1}).to_list(50000)
    by_day: dict[str, list[float]] = {}
    for x in chart_sales:
        by_day.setdefault(x["date"], []).append(x["total"])
    chart = []
    d = sd
    while d <= ed:
        vals = by_day.get(d.isoformat(), [])
        chart.append(ChartPoint(date=d.isoformat(), total=sum(vals), count=len(vals)))
        d += timedelta(days=1)

    prods = await db.products.find({"active": True, "$expr": {"$lte": ["$stock", "$min_stock"]}},
                                   {"_id": 0}).sort("stock", 1).to_list(200)
    low = [LowStockItem(**p) for p in prods if p["stock"] > 0]
    out = [LowStockItem(**p) for p in prods if p["stock"] <= 0]
    due = await db.debts.find({"status": "open", "due_date": {"$ne": None, "$lte": datetime.now(store_tz()).date().isoformat()}},
                              {"_id": 0, "id": 1, "customer_name": 1, "invoice_no": 1, "remaining": 1, "due_date": 1, "customer_id": 1}
                              ).sort("due_date", 1).to_list(100)
    recent = await db.sales.find({}, {"_id": 0}).sort("created_at", -1).to_list(8)
    return Dashboard(start=s, end=e, total_sales=total, transaction_count=len(sales), items_sold=items_sold,
                     profit=profit, low_stock=low, out_of_stock=out, recent_sales=[Sale(**r) for r in recent],
                     chart=chart, payment_breakdown=breakdown, due_debts=due, expiring=await expiring_list())



async def expiring_list() -> list[dict]:
    """Batches (from purchases) expiring within settings.expiry_warning_days, or already expired, whose product still has stock."""
    from routers.sales import get_settings
    settings = await get_settings()
    today = datetime.now(store_tz()).date()
    limit = (today + timedelta(days=settings.expiry_warning_days)).isoformat()
    out = []
    async for b in db.product_batches.find({"dismissed": False, "expiry_date": {"$lte": limit}}, {"_id": 0}).sort("expiry_date", 1):
        p = await db.products.find_one({"id": b["product_id"]}, {"_id": 0, "stock": 1, "unit": 1, "sku": 1})
        if not p or p.get("stock", 0) <= 0:
            continue
        days = (datetime.fromisoformat(b["expiry_date"]).date() - today).days
        out.append({"id": b["id"], "product_name": b["product_name"], "sku": p.get("sku", ""), "expiry_date": b["expiry_date"],
                    "days_left": days, "qty": b["qty"], "stock": p["stock"], "unit": p.get("unit", "pcs"),
                    "invoice_no": b["invoice_no"], "supplier_name": b["supplier_name"]})
    return out[:100]
