"""Morning WhatsApp summary (due debts + expiring items + stock alerts + yesterday sales).
One-click wa.me on the dashboard, and automatic 07:00 WIB send through Fonnte (cron)."""

import asyncio
import hmac
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from urllib.parse import quote

from integrations.fonnte import FonnteError, get_token, normalize, send_whatsapp
from lib.auth import audit, get_current_user, require_admin
from lib.db import db
from models.schemas import (FonnteStatus, FonnteTokenIn, MorningSummary, NotificationLog, WaReceiptIn,
                            WaReceiptPreview, WaReceiptResult)
from routers.dashboard import expiring_list
from routers.sales import get_settings, store_tz

router = APIRouter(tags=["notifications"])
cron_router = APIRouter(prefix="/cron", tags=["cron"])
logger = logging.getLogger("wbc.notifications")


def _rp(v: float) -> str:
    return "Rp " + f"{round(v):,}".replace(",", ".")


async def build_summary() -> MorningSummary:
    settings = await get_settings()
    today = datetime.now(store_tz()).date()
    t, y = today.isoformat(), (today - timedelta(days=1)).isoformat()
    debts = await db.debts.find({"status": "open", "due_date": {"$ne": None, "$lte": t}}, {"_id": 0}).sort("due_date", 1).to_list(100)
    exp = await expiring_list()
    out = await db.products.count_documents({"active": True, "stock": {"$lte": 0}})
    low = await db.products.count_documents({"active": True, "stock": {"$gt": 0}, "$expr": {"$lte": ["$stock", "$min_stock"]}})
    ysales = await db.sales.find({"date": y, "status": "completed"}, {"_id": 0, "total": 1}).to_list(10000)
    lines = [f"*RINGKASAN PAGI — {settings.store_name}*", today.strftime("%d-%m-%Y"), "",
             f"Penjualan kemarin: {_rp(sum(s['total'] for s in ysales))} ({len(ysales)} transaksi)", ""]
    due_total = sum(d["remaining"] for d in debts)
    if debts:
        lines.append(f"*Hutang jatuh tempo ({len(debts)}) — {_rp(due_total)}*")
        lines += [f"• {d['customer_name']} {_rp(d['remaining'])} ({'hari ini' if d['due_date'] == t else 'lewat sejak ' + d['due_date']})" for d in debts[:15]]
    else:
        lines.append("Hutang jatuh tempo: tidak ada")
    lines.append("")
    if exp:
        lines.append(f"*Barang hampir/sudah kedaluwarsa ({len(exp)})*")
        lines += [f"• {e['product_name']} — {e['expiry_date']} ({'LEWAT ' + str(-e['days_left']) + ' hari' if e['days_left'] < 0 else str(e['days_left']) + ' hari lagi'}), stok {e['stock']:g} {e['unit']}" for e in exp[:15]]
    else:
        lines.append("Barang kedaluwarsa: aman")
    lines += ["", f"Stok habis: {out} produk · Stok menipis: {low} produk"]
    return MorningSummary(date=t, text="\n".join(lines), due_debts=len(debts), due_total=due_total,
                          expiring=len(exp), out_of_stock=out, low_stock=low)


async def _log(kind: str, source: str, target: str, ok: bool, reason: str = "") -> None:
    await db.notification_logs.insert_one(NotificationLog(kind=kind, source=source, target=target, status=ok,
                                                          reason=reason, created_at=datetime.now(timezone.utc)).model_dump())


async def _send(kind: str, source: str, text: str) -> NotificationLog:
    settings = await get_settings()
    try:
        await send_whatsapp(settings.owner_whatsapp, text)
        ok, reason = True, ""
    except FonnteError as e:
        ok, reason = False, str(e)
    logger.info("whatsapp %s via %s ok=%s %s", kind, source, ok, reason)
    await _log(kind, source, settings.owner_whatsapp, ok, reason)
    return NotificationLog(kind=kind, source=source, target=settings.owner_whatsapp, status=ok, reason=reason,
                           created_at=datetime.now(timezone.utc))


@router.get("/notifications/morning-summary", response_model=MorningSummary)
async def morning_summary(_: dict = Depends(require_admin)):
    return await build_summary()


@router.post("/notifications/morning-summary/send", response_model=NotificationLog)
async def send_morning_now(admin: dict = Depends(require_admin)):
    res = await _send("morning_summary", "manual", (await build_summary()).text)
    await audit(admin, "whatsapp_send", f"morning_summary ok={res.status}")
    return res


@router.get("/notifications/logs", response_model=list[NotificationLog])
async def notification_logs(_: dict = Depends(require_admin)):
    return await db.notification_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)


@router.get("/integrations/fonnte", response_model=FonnteStatus)
async def fonnte_status(_: dict = Depends(require_admin)):
    token, source = await get_token()
    return FonnteStatus(configured=bool(token), source=source, owner_whatsapp=(await get_settings()).owner_whatsapp)


@router.put("/integrations/fonnte", response_model=FonnteStatus)
async def set_fonnte_token(body: FonnteTokenIn, admin: dict = Depends(require_admin)):
    token = body.token.strip()
    if token:
        await db.secrets.update_one({"key": "fonnte_token"}, {"$set": {"value": token}}, upsert=True)
    else:
        await db.secrets.delete_one({"key": "fonnte_token"})
    await audit(admin, "fonnte_token_update", "set" if token else "removed")
    return await fonnte_status(admin)


@router.post("/integrations/fonnte/test", response_model=NotificationLog)
async def fonnte_test(admin: dict = Depends(require_admin)):
    settings = await get_settings()
    return await _send("test", "manual", f"Tes WhatsApp dari {settings.store_name} berhasil ✅")


PAY_LABELS = {"cash": "Cash", "qris": "QRIS", "transfer": "Transfer", "debit": "Debit", "kredit": "Kredit",
              "ewallet": "E-wallet", "hutang": "Hutang"}


def _n(v: float) -> str:
    return f"{round(v):,}".replace(",", ".")


async def receipt_text(sale: dict) -> str:
    s = await get_settings()
    when = sale["created_at"]
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    hr = "--------------------------------"
    lines = [f"*{s.store_name}*", s.address, f"WA: {s.whatsapp}", hr, "*STRUK DIGITAL*",
             f"No      : {sale['invoice_no']}", f"Tanggal : {when.astimezone(store_tz()).strftime('%d-%m-%Y %H:%M')}",
             f"Kasir   : {sale['cashier_name']}"]
    if sale.get("customer_name"):
        lines.append(f"Member  : {sale['customer_name']}")
    lines.append(hr)
    for i in sale["items"]:
        tag = " (PROMO)" if i.get("price_type") == "promo" else " (GROSIR)" if i.get("price_type") == "grosir" else ""
        disc = f" -{_n(i['discount'])}" if i.get("discount") else ""
        lines += [i["name"], f"  {i['qty']:g} {i['unit']} x {_n(i['price'])}{tag}{disc} = {_n(i['subtotal'])}"]
    lines += [hr, f"Subtotal : {_n(sale['subtotal'])}"]
    if sale.get("discount"):
        lines.append(f"Diskon   : -{_n(sale['discount'])}")
    if sale.get("tax"):
        lines.append(f"Pajak    : {_n(sale['tax'])}")
    lines += [f"*TOTAL   : Rp {_n(sale['total'])}*",
              f"Bayar ({PAY_LABELS.get(sale['payment_method'], sale['payment_method'])}) : {_n(sale['amount_paid'])}"]
    if sale["payment_method"] == "hutang":
        lines.append(f"Sisa hutang : {_n(sale['total'] - sale['amount_paid'])}")
    else:
        lines.append(f"Kembalian : {_n(sale.get('change', 0))}")
    if sale.get("points_redeemed"):
        lines.append(f"Tukar {sale['points_redeemed']} poin : -{_n(sale.get('points_discount', 0))}")
    if sale.get("points_earned"):
        lines.append(f"Poin didapat : +{sale['points_earned']}")
    if sale.get("status") == "void":
        lines.append("*** VOID ***")
    lines += [hr, s.receipt_footer]
    return "\n".join(lines)


async def _sale_or_404(id: str) -> dict:
    sale = await db.sales.find_one({"id": id}, {"_id": 0})
    if not sale:
        raise HTTPException(404, "Transaksi tidak ditemukan")
    return sale


@router.get("/sales/{id}/whatsapp", response_model=WaReceiptPreview)
async def wa_receipt_preview(id: str, _: dict = Depends(get_current_user)):
    sale = await _sale_or_404(id)
    phone = ""
    if sale.get("customer_id"):
        c = await db.customers.find_one({"id": sale["customer_id"]}, {"_id": 0, "whatsapp": 1})
        phone = (c or {}).get("whatsapp", "")
    token, _src = await get_token()
    return WaReceiptPreview(phone=phone, customer_name=sale.get("customer_name"), text=await receipt_text(sale),
                            fonnte_configured=bool(token))


@router.post("/sales/{id}/whatsapp", response_model=WaReceiptResult)
async def wa_receipt_send(id: str, body: WaReceiptIn, user: dict = Depends(get_current_user)):
    sale = await _sale_or_404(id)
    text = await receipt_text(sale)
    target = normalize(body.phone)
    link = f"https://wa.me/{target}?text={quote(text)}"
    token, _src = await get_token()
    if not token:
        ok, reason, via = False, "Token Fonnte belum diatur — gunakan tautan WhatsApp", "link"
    else:
        try:
            await send_whatsapp(target, text)
            ok, reason, via = True, "", "fonnte"
        except FonnteError as e:
            ok, reason, via = False, str(e), "link"
    await _log("receipt", "fonnte" if token else "link", target, ok, reason)
    await audit(user, "whatsapp_receipt", f"{sale['invoice_no']} -> {target} ok={ok}")
    return WaReceiptResult(sent=ok, via=via, target=target, reason=reason, wa_link=link)


async def _morning_job(run_id: str) -> None:
    try:
        settings = await get_settings()
        if not settings.morning_summary_enabled:
            await _log("morning_summary", "cron", settings.owner_whatsapp, False, "Dinonaktifkan di Pengaturan")
            return
        await _send("morning_summary", "cron", (await build_summary()).text)
    except Exception:
        logger.exception("morning summary failed (run %s)", run_id)


@cron_router.post("/morning-summary", status_code=202)
async def cron_morning_summary(request: Request):
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
        asyncio.create_task(_morning_job(run_id))
    return {"success": True, "message": "accepted"}
