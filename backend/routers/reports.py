import asyncio
import hmac
import io
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from lib.auth import require_admin
from lib.db import db
from models.schemas import DailyReport, DailyReportSnapshot, MonthlyDay, MonthlyReport, RestockGroup, RestockItem
from routers.sales import get_settings, store_tz

router = APIRouter(prefix="/reports", tags=["reports"])
cron_router = APIRouter(prefix="/cron", tags=["cron"])
logger = logging.getLogger("wbc.reports")

PAY = {"cash": "Cash", "qris": "QRIS", "transfer": "Transfer", "debit": "Debit", "kredit": "Kredit", "ewallet": "E-Wallet", "hutang": "Hutang"}
MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def _date(date: str) -> str:
    if not date:
        return datetime.now(store_tz()).strftime("%Y-%m-%d")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(422, "Format tanggal harus YYYY-MM-DD")
    return date


def _long_date(d: str) -> str:
    y, m, day = d.split("-")
    return f"{int(day)} {MONTHS[int(m) - 1]} {y}"


def _rp(v: float) -> str:
    return "Rp " + f"{round(v):,}".replace(",", ".")


async def build_daily(date: str) -> DailyReport:
    sales = await db.sales.find({"date": date}, {"_id": 0}).to_list(20000)
    done = [s for s in sales if s["status"] == "completed"]
    returns = await db.returns.find({"type": "sale", "date": date}, {"_id": 0}).to_list(5000)
    by_payment: dict[str, float] = {}
    prod: dict[str, dict] = {}
    modal = 0.0
    for s in done:
        by_payment[s["payment_method"]] = by_payment.get(s["payment_method"], 0) + s["total"]
        for i in s["items"]:
            modal += i["buy_price"] * i["qty"]
            p = prod.setdefault(i["product_id"], {"name": i["name"], "qty": 0, "omzet": 0, "profit": 0})
            p["qty"] += i["qty"]
            p["omzet"] += i["subtotal"]
            p["profit"] += i["subtotal"] - i["buy_price"] * i["qty"]
    omzet = sum(s["total"] for s in done)
    discount = sum(s["discount"] + sum(i["discount"] for i in s["items"]) for s in done)
    net_before_tax = sum(s["subtotal"] - s["discount"] for s in done)
    top = sorted(prod.values(), key=lambda x: -x["qty"])[:10]
    exps = await db.expenses.find({"date": date}, {"_id": 0}).to_list(5000)
    by_cat: dict[str, float] = {}
    for e in exps:
        by_cat[e["category"]] = by_cat.get(e["category"], 0) + e["amount"]
    exp_total = sum(by_cat.values())
    profit = net_before_tax - modal
    debt_new = sum(s["total"] - s["amount_paid"] for s in done if s["payment_method"] == "hutang")
    collected = 0.0
    async for d in db.debts.find({"payments": {"$exists": True, "$ne": []}}, {"payments": 1}):
        for p in d["payments"]:
            ts = p["created_at"] if p["created_at"].tzinfo else p["created_at"].replace(tzinfo=timezone.utc)
            if ts.astimezone(store_tz()).strftime("%Y-%m-%d") == date:
                collected += p["amount"]
    return DailyReport(date=date, transaction_count=len(done), items_sold=sum(i["qty"] for s in done for i in s["items"]),
                       omzet=omzet, discount=discount, modal=modal, profit=profit,
                       by_payment=by_payment, void_count=len(sales) - len(done),
                       sale_returns_total=sum(r["total"] for r in returns), top_products=top,
                       expenses_total=exp_total, expenses_by_category=by_cat, net_profit=profit - exp_total,
                       debt_new=debt_new, debt_collected=collected)


@router.get("/daily", response_model=DailyReport)
async def daily(date: str = "", _: dict = Depends(require_admin)):
    return await build_daily(_date(date))


def _rows(r: DailyReport) -> list[tuple[str, str]]:
    rows = [("Total transaksi", str(r.transaction_count)), ("Produk terjual", f"{r.items_sold:g}"),
            ("Omzet", _rp(r.omzet)), ("Diskon", _rp(r.discount)), ("Modal", _rp(r.modal)),
            ("Estimasi keuntungan", _rp(r.profit))]
    rows += [(PAY.get(k, k), _rp(v)) for k, v in r.by_payment.items()]
    rows += [(f"Pengeluaran: {k}", _rp(v)) for k, v in r.expenses_by_category.items()]
    rows += [("Total pengeluaran", _rp(r.expenses_total)), ("Laba bersih", _rp(r.net_profit)),
             ("Hutang baru", _rp(r.debt_new)), ("Cicilan hutang diterima", _rp(r.debt_collected))]
    rows += [("Transaksi void", str(r.void_count)), ("Retur penjualan", _rp(r.sale_returns_total))]
    return rows


@router.get("/daily.xlsx")
async def daily_excel(date: str = "", _: dict = Depends(require_admin)):
    from openpyxl import Workbook
    from openpyxl.styles import Font

    r = await build_daily(_date(date))
    s = await get_settings()
    wb = Workbook()
    ws = wb.active
    ws.title = "Laporan Harian"
    ws.append([s.store_name])
    ws.append(["LAPORAN PENJUALAN HARIAN"])
    ws.append(["Tanggal", _long_date(r.date)])
    ws.append([])
    for label, _v in _rows(r):
        ws.append([label, _v])
    ws.append([])
    ws.append(["Produk terlaris", "Qty", "Omzet", "Keuntungan"])
    for p in r.top_products:
        ws.append([p["name"], p["qty"], p["omzet"], p["profit"]])
    for c in ("A1", "A2"):
        ws[c].font = Font(bold=True, size=13)
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 20
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="laporan-harian-{r.date}.xlsx"'})


@router.get("/daily.pdf")
async def daily_pdf(date: str = "", _: dict = Depends(require_admin)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    r = await build_daily(_date(date))
    s = await get_settings()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f"Laporan Harian {r.date}")
    st = getSampleStyleSheet()
    style = TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 10),
                        ("ALIGN", (1, 0), (-1, -1), "RIGHT")])
    story = [Paragraph(s.store_name, st["Title"]), Paragraph("LAPORAN PENJUALAN HARIAN", st["Heading2"]),
             Paragraph(f"Tanggal: {_long_date(r.date)}", st["Normal"]), Spacer(1, 12),
             Table(_rows(r), colWidths=[220, 160], style=style), Spacer(1, 16)]
    if r.top_products:
        story.append(Paragraph("Produk Terlaris", st["Heading3"]))
        data = [("Produk", "Qty", "Omzet", "Keuntungan")] + [
            (p["name"], f"{p['qty']:g}", _rp(p["omzet"]), _rp(p["profit"])) for p in r.top_products]
        t = Table(data, colWidths=[200, 50, 110, 110], style=style)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCFCE7"))]))
        story.append(t)
    doc.build(story)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="laporan-harian-{r.date}.pdf"'})


@router.get("/restock", response_model=list[RestockGroup])
async def restock(_: dict = Depends(require_admin)):
    prods = await db.products.find({"active": True, "$expr": {"$lte": ["$stock", "$min_stock"]}},
                                   {"_id": 0}).sort("name", 1).to_list(2000)
    groups: dict[str, list[RestockItem]] = {}
    for p in prods:
        qty = max(p["min_stock"] * 2 - p["stock"], 1)
        groups.setdefault(p.get("supplier") or "Tanpa supplier", []).append(RestockItem(
            id=p["id"], sku=p["sku"], name=p["name"], unit=p.get("unit", "pcs"), stock=p["stock"],
            min_stock=p["min_stock"], suggested_qty=qty, buy_price=p["buy_price"], estimated_cost=qty * p["buy_price"]))
    out = [RestockGroup(supplier=k, items=v, total_cost=sum(i.estimated_cost for i in v)) for k, v in groups.items()]
    return sorted(out, key=lambda g: (g.supplier == "Tanpa supplier", g.supplier))


# ---------- archived nightly snapshots (daily_reports) ----------
async def save_snapshot(date: str, source: str) -> DailyReportSnapshot:
    snap = DailyReportSnapshot(date=date, generated_at=datetime.now(timezone.utc), source=source,
                               report=await build_daily(date))
    await db.daily_reports.update_one({"date": date}, {"$set": snap.model_dump()}, upsert=True)
    return snap


@router.get("/archive", response_model=list[DailyReportSnapshot])
async def archive(_: dict = Depends(require_admin)):
    return await db.daily_reports.find({}, {"_id": 0}).sort("date", -1).to_list(400)


@router.post("/archive/{date}", response_model=DailyReportSnapshot)
async def snapshot_now(date: str, _: dict = Depends(require_admin)):
    return await save_snapshot(_date(date), "manual")


async def _nightly_job(run_id: str) -> None:
    try:
        today = datetime.now(store_tz()).date()
        await save_snapshot(today.isoformat(), "cron")
        yesterday = (today - timedelta(days=1)).isoformat()
        if not await db.daily_reports.find_one({"date": yesterday}):  # catch-up if a night was missed
            await save_snapshot(yesterday, "cron")
        logger.info("nightly report saved (run %s)", run_id)
    except Exception:
        logger.exception("nightly report failed (run %s)", run_id)


@cron_router.post("/daily-report", status_code=202)
async def cron_daily_report(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not secret or not token or not hmac.compare_digest(token, secret):
        raise HTTPException(401, "Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if body is not None and not isinstance(body, dict):
        raise HTTPException(400, "Invalid body")
    run_id = request.headers.get("x-webhook-id") or (body or {}).get("run_id") or datetime.now(timezone.utc).isoformat()
    res = await db.cron_runs.update_one({"run_id": run_id}, {"$setOnInsert": {"run_id": run_id, "at": datetime.now(timezone.utc)}}, upsert=True)
    if res.upserted_id is not None:
        asyncio.create_task(_nightly_job(run_id))
    return {"success": True, "message": "accepted"}


@router.get("/monthly", response_model=MonthlyReport)
async def monthly(month: str = "", _: dict = Depends(require_admin)):
    import calendar
    month = month or datetime.now(store_tz()).strftime("%Y-%m")
    try:
        y, m = map(int, month.split("-"))
        last = calendar.monthrange(y, m)[1]
    except (ValueError, calendar.IllegalMonthError):
        raise HTTPException(422, "Format bulan harus YYYY-MM")
    start, end = f"{month}-01", f"{month}-{last:02d}"
    days = {f"{month}-{d:02d}": {"omzet": 0.0, "modal": 0.0, "profit": 0.0, "expenses": 0.0, "transactions": 0}
            for d in range(1, last + 1)}
    async for s in db.sales.find({"date": {"$gte": start, "$lte": end}, "status": "completed"}, {"_id": 0}):
        d = days[s["date"]]
        cost = sum(i["buy_price"] * i["qty"] for i in s["items"])
        d["omzet"] += s["total"]
        d["modal"] += cost
        d["profit"] += s["subtotal"] - s["discount"] - cost
        d["transactions"] += 1
    async for e in db.expenses.find({"date": {"$gte": start, "$lte": end}}, {"_id": 0}):
        days[e["date"]]["expenses"] += e["amount"]
    rows = [MonthlyDay(date=k, net=v["profit"] - v["expenses"], **v) for k, v in days.items()]
    tot = lambda f: sum(getattr(r, f) for r in rows)  # noqa: E731
    return MonthlyReport(month=month, days=rows, omzet=tot("omzet"), modal=tot("modal"), profit=tot("profit"),
                         expenses=tot("expenses"), net=tot("net"), transactions=int(tot("transactions")))
