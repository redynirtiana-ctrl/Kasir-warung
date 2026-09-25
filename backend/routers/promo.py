"""Weekly promo broadcast to members via WhatsApp.
Fonnte mode: sends in the background with a delay between messages (anti-blokir); progress is polled.
Link mode (no token): the admin opens wa.me per member; we only record the campaign for the weekly check."""

import asyncio
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from integrations.fonnte import FonnteError, get_token, normalize, send_whatsapp
from lib.auth import audit, require_admin
from lib.db import db
from models.schemas import PromoCampaign, PromoDraft, PromoProduct, PromoRecipient, PromoSendIn
from routers.sales import get_settings, store_tz

router = APIRouter(prefix="/promo", tags=["promo"])
logger = logging.getLogger("wbc.promo")
_tasks: set[asyncio.Task] = set()


def _delay() -> float:
    base = float(os.environ.get("PROMO_SEND_DELAY_SECONDS", "6"))
    return base + random.uniform(0, base / 2)  # jittered pause between messages keeps the number safe from blocks


def _n(v: float) -> str:
    return f"{round(v):,}".replace(",", ".")


async def _promo_products() -> list[PromoProduct]:
    today = datetime.now(store_tz()).date().isoformat()
    out = []
    async for p in db.products.find({"active": True, "promo_price": {"$gt": 0}}, {"_id": 0}).sort("name", 1):
        start, end = p.get("promo_start"), p.get("promo_end")
        if (not start or start <= today) and (not end or today <= end) and p["promo_price"] < p["sell_price"]:
            out.append(PromoProduct(name=p["name"], unit=p.get("unit", "pcs"), normal_price=p["sell_price"],
                                    promo_price=p["promo_price"], promo_end=end))
    return out


async def _recipients() -> list[PromoRecipient]:
    docs = await db.customers.find({"whatsapp": {"$nin": ["", None]}}, {"_id": 0, "id": 1, "name": 1, "whatsapp": 1}).sort("name", 1).to_list(5000)
    return [PromoRecipient(customer_id=d["id"], name=d["name"], whatsapp=d["whatsapp"]) for d in docs]


async def draft_text(products: list[PromoProduct]) -> str:
    s = await get_settings()
    lines = [f"🛒 *PROMO MINGGU INI — {s.store_name}* 🛒", "", "Halo Kak {nama}! Ada harga spesial buat member setia:", ""]
    if products:
        for p in products[:20]:
            until = f" (s/d {datetime.fromisoformat(p.promo_end).strftime('%d-%m')})" if p.promo_end else ""
            lines.append(f"• {p.name}: ~Rp {_n(p.normal_price)}~ *Rp {_n(p.promo_price)}*/{p.unit}{until}")
    else:
        lines.append("• (tulis promo di sini)")
    lines += ["", "Yuk mampir sebelum kehabisan! Tunjukkan kartu member untuk kumpulkan poin ya 🙏", "",
              f"{s.store_name}", s.address]
    if s.whatsapp:
        lines.append(f"WA: {s.whatsapp}")
    return "\n".join(lines)


def personalize(text: str, name: str) -> str:
    return text.replace("{nama}", name)


def _week_start() -> datetime:
    now = datetime.now(store_tz())
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.astimezone(timezone.utc)


@router.get("/broadcast", response_model=PromoDraft)
async def promo_draft(_: dict = Depends(require_admin)):
    products = await _promo_products()
    last = await db.promo_campaigns.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    token, _src = await get_token()
    sent_week = bool(last and last["created_at"].replace(tzinfo=last["created_at"].tzinfo or timezone.utc) >= _week_start())
    return PromoDraft(text=await draft_text(products), promo_products=products, recipients=await _recipients(),
                      fonnte_configured=bool(token), sent_this_week=sent_week,
                      last_campaign=PromoCampaign(**last) if last else None)


async def _run_campaign(cid: str, text: str, recipients: list[PromoRecipient]) -> None:
    for i, r in enumerate(recipients):
        target = normalize(r.whatsapp)
        try:
            await send_whatsapp(target, personalize(text, r.name))
            ok, reason = True, ""
        except FonnteError as e:
            ok, reason = False, str(e)
        except Exception:
            logger.exception("promo send failed")
            ok, reason = False, "Kesalahan tak terduga"
        await db.promo_campaigns.update_one({"id": cid}, {
            "$inc": {"sent": int(ok), "failed": int(not ok)},
            "$push": {"results": {"name": r.name, "target": target, "ok": ok, "reason": reason}}})
        if i < len(recipients) - 1:
            await asyncio.sleep(_delay())
    await db.promo_campaigns.update_one({"id": cid}, {"$set": {"status": "done", "finished_at": datetime.now(timezone.utc)}})
    logger.info("promo campaign %s done", cid)


@router.post("/broadcast", response_model=PromoCampaign)
async def promo_send(body: PromoSendIn, admin: dict = Depends(require_admin)):
    running = await db.promo_campaigns.find_one({"status": "running"})
    if running:
        raise HTTPException(409, "Masih ada pengiriman promo yang berjalan")
    recipients = await _recipients()
    if not recipients:
        raise HTTPException(400, "Belum ada member yang punya nomor WhatsApp")
    if body.mode == "fonnte":
        token, _src = await get_token()
        if not token:
            raise HTTPException(400, "Token Fonnte belum diatur — gunakan kirim manual (wa.me)")
    camp = PromoCampaign(id=str(uuid.uuid4()), text=body.text, total=len(recipients),
                         status="running" if body.mode == "fonnte" else "link",
                         username=admin["username"], created_at=datetime.now(timezone.utc))
    await db.promo_campaigns.insert_one(camp.model_dump())
    if body.mode == "fonnte":
        task = asyncio.create_task(_run_campaign(camp.id, body.text, recipients))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    await audit(admin, "whatsapp_promo", f"{body.mode} ke {len(recipients)} member")
    return camp


@router.get("/campaigns/{id}", response_model=PromoCampaign)
async def promo_campaign(id: str, _: dict = Depends(require_admin)):
    doc = await db.promo_campaigns.find_one({"id": id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Kampanye tidak ditemukan")
    return PromoCampaign(**doc)
