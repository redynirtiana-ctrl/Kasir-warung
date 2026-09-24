"""Data export: GET /api/v1/export/{entity}.{fmt}  entity = products|sales|purchases|customers|suppliers, fmt = xlsx|csv."""

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from lib.auth import require_admin
from lib.db import db
from routers.sales import store_tz

router = APIRouter(prefix="/export", tags=["export"])


def _ts(v) -> str:
    return v.astimezone(store_tz()).strftime("%Y-%m-%d %H:%M") if isinstance(v, datetime) and v.tzinfo else (
        v.strftime("%Y-%m-%d %H:%M") if isinstance(v, datetime) else "")


async def _rows(entity: str, start: str | None, end: str | None) -> tuple[list[str], list[list]]:
    date_q = {"date": {k: v for k, v in (("$gte", start), ("$lte", end)) if v}} if (start or end) else {}
    if entity == "products":
        head = ["SKU", "Barcode", "Nama", "Kategori", "Satuan", "Harga Beli", "Harga Jual", "Harga Promo", "Promo Mulai",
                "Promo Selesai", "Harga Grosir", "Stok", "Stok Minimum", "Supplier", "Status"]
        rows = [[p["sku"], p.get("barcode") or "", p["name"], p.get("category_name") or "", p.get("unit", ""), p["buy_price"],
                 p["sell_price"], p.get("promo_price") or "", p.get("promo_start") or "", p.get("promo_end") or "",
                 "; ".join(f"≥{t['min_qty']:g}: {t['price']:g}" for t in p.get("wholesale_tiers") or []),
                 p["stock"], p.get("min_stock", 0), p.get("supplier", ""), "Aktif" if p.get("active", True) else "Nonaktif"]
                async for p in db.products.find({}, {"_id": 0}).sort("name", 1)]
    elif entity == "sales":
        head = ["No. Transaksi", "Tanggal", "Waktu", "Kasir", "Pelanggan", "Produk", "Qty Item", "Subtotal", "Diskon",
                "Pajak", "Total", "Metode", "Bayar", "Kembalian", "Status", "Alasan Void"]
        rows = [[s["invoice_no"], s["date"], _ts(s["created_at"]), s.get("cashier_name", ""), s.get("customer_name") or "",
                 ", ".join(f"{i['name']} x{i['qty']:g}" for i in s["items"]), sum(i["qty"] for i in s["items"]),
                 s["subtotal"], s["discount"], s["tax"], s["total"], s["payment_method"], s["amount_paid"], s["change"],
                 s["status"], s.get("void_reason") or ""]
                async for s in db.sales.find(date_q, {"_id": 0}).sort("created_at", -1)]
    elif entity == "purchases":
        head = ["Tanggal", "No. Invoice", "Supplier", "Produk", "Total", "Catatan", "Dicatat oleh"]
        rows = [[p["date"], p["invoice_no"], p["supplier_name"], ", ".join(f"{i['name']} x{i['qty']:g} @{i['buy_price']:g}" for i in p["items"]),
                 p["total"], p.get("note", ""), p.get("username", "")]
                async for p in db.purchases.find(date_q, {"_id": 0}).sort("date", -1)]
    elif entity == "customers":
        debts: dict[str, float] = {}
        async for d in db.debts.find({"status": "open"}, {"_id": 0, "customer_id": 1, "remaining": 1}):
            debts[d["customer_id"]] = debts.get(d["customer_id"], 0) + d["remaining"]
        head = ["Nama", "WhatsApp", "Alamat", "Catatan", "Poin", "Sisa Hutang"]
        rows = [[c["name"], c.get("whatsapp", ""), c.get("address", ""), c.get("note", ""), c.get("points", 0), debts.get(c["id"], 0)]
                async for c in db.customers.find({}, {"_id": 0}).sort("name", 1)]
    elif entity == "suppliers":
        head = ["Nama", "Kontak", "Telepon", "Alamat", "Catatan"]
        rows = [[s["name"], s.get("contact_name", ""), s.get("phone", ""), s.get("address", ""), s.get("note", "")]
                async for s in db.suppliers.find({}, {"_id": 0}).sort("name", 1)]
    else:
        raise HTTPException(404, "Jenis data tidak dikenal")
    return head, rows


@router.get("/{entity}.{fmt}")
async def export(entity: str, fmt: str, start: str | None = None, end: str | None = None, _: dict = Depends(require_admin)):
    if fmt not in ("xlsx", "csv"):
        raise HTTPException(404, "Format harus xlsx atau csv")
    head, rows = await _rows(entity, start, end)
    stamp = datetime.now(store_tz()).strftime("%Y%m%d")
    filename = f"{entity}-{stamp}.{fmt}"
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(head)
        w.writerows(rows)
        data = io.BytesIO(("\ufeff" + buf.getvalue()).encode())  # BOM so Excel reads UTF-8
        media = "text/csv; charset=utf-8"
    else:
        from openpyxl import Workbook
        from openpyxl.styles import Font
        wb = Workbook()
        ws = wb.active
        ws.title = entity
        ws.append(head)
        for c in ws[1]:
            c.font = Font(bold=True)
        for r in rows:
            ws.append(r)
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = min(max(len(str(c.value or "")) for c in col) + 2, 50)
        data = io.BytesIO()
        wb.save(data)
        data.seek(0)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return StreamingResponse(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
