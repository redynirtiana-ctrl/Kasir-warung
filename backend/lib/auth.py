"""JWT (httpOnly cookie) + bcrypt helpers and role guards."""

import os
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from lib.db import db

COOKIE_NAME = "wbc_token"
TOKEN_HOURS = 12
ALGO = "HS256"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    return jwt.encode({"sub": user_id, "role": role, "exp": exp}, os.environ["JWT_SECRET"], algorithm=ALGO)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Belum login")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesi tidak valid atau kedaluwarsa")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(401, "Pengguna tidak aktif")
    return user


def require_roles(*roles: str):
    async def guard(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Akses ditolak untuk role ini")
        return user

    return guard


require_admin = require_roles("admin")

# Simple in-memory login rate limiter: max 5 failures per IP per 60 s.
_failures: dict[str, list[float]] = {}


def check_rate_limit(ip: str) -> None:
    now = time.time()
    recent = [t for t in _failures.get(ip, []) if now - t < 60]
    _failures[ip] = recent
    if len(recent) >= 5:
        raise HTTPException(429, "Terlalu banyak percobaan login. Coba lagi 1 menit.")


def record_failure(ip: str) -> None:
    _failures.setdefault(ip, []).append(time.time())


async def audit(user: dict | None, action: str, detail: str = "") -> None:
    await db.audit_logs.insert_one({
        "user_id": user["id"] if user else None,
        "username": user["username"] if user else None,
        "action": action,
        "detail": detail,
        "created_at": datetime.now(timezone.utc),
    })


# ---------- per-feature permissions (kasir) ----------
# Admin/Owner always has every permission. Kasir gets the explicit list stored on the user doc,
# or DEFAULT_KASIR_PERMISSIONS when the field has never been set (existing accounts).
PERMISSIONS: dict[str, str] = {
    "give_discount": "Beri diskon (per barang & transaksi)",
    "sell_on_credit": "Jual hutang (bayar Hutang)",
    "void_sale": "Void / batalkan transaksi",
    "process_returns": "Proses retur penjualan",
    "receive_debt_payment": "Terima cicilan hutang & lihat piutang",
    "view_reports": "Lihat laporan (harian, bulanan, per kasir)",
}
DEFAULT_KASIR_PERMISSIONS = ["give_discount", "sell_on_credit"]


def effective_permissions(user: dict) -> list[str]:
    if user.get("role") == "admin":
        return list(PERMISSIONS)
    stored = user.get("permissions")
    return [p for p in (DEFAULT_KASIR_PERMISSIONS if stored is None else stored) if p in PERMISSIONS]


def has_perm(user: dict, perm: str) -> bool:
    return perm in effective_permissions(user)


def require_perm(perm: str):
    """Dependency factory: 403 unless the (freshly loaded) user holds `perm`. Denials are audited."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if not has_perm(user, perm):
            await audit(user, "permission_denied", perm)
            raise HTTPException(403, f"Tidak punya izin: {PERMISSIONS.get(perm, perm)}")
        return user
    return dep
