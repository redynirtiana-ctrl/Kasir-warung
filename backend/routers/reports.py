import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from lib.auth import require_admin
from lib.db import db
from models.schemas import DailyReport, RestockGroup, RestockItem
from routers.sales import get_settings, store_tz

router = APIRouter(prefix="/reports", tags=["reports"])

PAY = {"cash": "Cash", "qris": "QRIS", "transfer": "Transfer", "debit": "Debit", "kredit": "Kredit", "ewallet": "E-Wallet"}
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
    return DailyReport(date=date, transaction_count=len(done), items_sold=sum(i["qty"] for s in done for i in s["items"]),
                       omzet=omzet, discount=discount, modal=modal, profit=net_before_tax - modal,
                       by_payment=by_payment, void_count=len(sales) - len(done),
                       sale_returns_total=sum(r["total"] for r in returns), top_products=top)


@router.get("/daily", response_model=DailyReport)
async def daily(date: str = "", _: dict = Depends(require_admin)):
    return await build_daily(_date(date))


def _rows(r: DailyReport) -> list[tuple[str, str]]:
    rows = [("Total transaksi", str(r.transaction_count)), ("Produk terjual", f"{r.items_sold:g}"),
            ("Omzet", _rp(r.omzet)), ("Diskon", _rp(r.discount)), ("Modal", _rp(r.modal)),
            ("Estimasi keuntungan", _rp(r.profit))]
    rows += [(PAY.get(k, k), _rp(v)) for k, v in r.by_payment.items()]
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
