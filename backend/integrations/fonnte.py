"""Fonnte WhatsApp API adapter (https://docs.fonnte.com/api-send-message/).
Isolated so the provider can be swapped without touching business code.
Token: `secrets` collection (set from Pengaturan) or FONNTE_TOKEN env fallback. Never returned to clients."""

import os

import httpx

from lib.db import db

API_URL = "https://api.fonnte.com/send"


class FonnteError(Exception):
    pass


async def get_token() -> tuple[str, str]:
    doc = await db.secrets.find_one({"key": "fonnte_token"})
    if doc and doc.get("value"):
        return doc["value"], "database"
    env = os.environ.get("FONNTE_TOKEN", "").strip()
    return (env, "env") if env else ("", "none")


def normalize(phone: str) -> str:
    n = "".join(ch for ch in phone if ch.isdigit())
    return "62" + n[1:] if n.startswith("0") else n


async def send_whatsapp(target: str, message: str) -> dict:
    token, _ = await get_token()
    if not token:
        raise FonnteError("Token Fonnte belum diatur")
    if not target:
        raise FonnteError("Nomor WhatsApp pemilik belum diisi di Pengaturan")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            # form-data (not JSON); Authorization is the raw token (no "Bearer")
            r = await client.post(API_URL, headers={"Authorization": token},
                                  data={"target": normalize(target), "message": message, "countryCode": "0"})
        body = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise FonnteError("Layanan Fonnte tidak dapat dihubungi") from exc
    if r.status_code >= 400:
        raise FonnteError(f"Fonnte menolak permintaan (HTTP {r.status_code})")
    if not body.get("status"):
        raise FonnteError(str(body.get("reason") or "Fonnte menolak pesan"))
    return body
