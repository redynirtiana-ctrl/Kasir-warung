"""Idempotent demo seed: users, categories, products, settings. Run: cd /app/backend && python seed.py"""

import asyncio
import uuid
from datetime import datetime, timezone

from lib.auth import hash_password
from lib.db import db, ensure_indexes

USERS = [("admin", "Bu Cucun (Owner)", "admin", "admin123"), ("kasir", "Kasir Toko", "kasir", "kasir123")]
CATEGORIES = ["Sembako", "Minuman", "Makanan", "Rokok", "Perawatan", "Rumah Tangga", "ATK"]
# sku, barcode, name, category, unit, buy, sell, stock, min
PRODUCTS = [
    ("SBK-001", "8991001000011", "Beras Premium 5 Kg", "Sembako", "karung", 68000, 75000, 20, 5),
    ("SBK-002", "8991001000028", "Minyak Goreng 1 Liter", "Sembako", "pcs", 15500, 18000, 36, 10),
    ("SBK-003", "8991001000035", "Gula Pasir 1 Kg", "Sembako", "pcs", 15000, 17500, 25, 8),
    ("SBK-004", "8991001000042", "Telur Ayam", "Sembako", "kg", 26000, 29000, 4, 5),
    ("MKN-001", "8991001000059", "Mie Instan", "Makanan", "pcs", 2800, 3500, 120, 24),
    ("MNM-001", "8991001000066", "Air Mineral 600ml", "Minuman", "botol", 2500, 4000, 48, 12),
    ("MNM-002", "8991001000073", "Kopi Sachet", "Minuman", "sachet", 1200, 2000, 80, 20),
    ("MNM-003", "8991001000080", "Teh Celup 25s", "Minuman", "kotak", 5500, 7000, 0, 5),
    ("PRW-001", "8991001000097", "Sabun Mandi", "Perawatan", "pcs", 3200, 4500, 30, 6),
    ("PRW-002", "8991001000103", "Shampoo Sachet", "Perawatan", "sachet", 800, 1000, 60, 12),
]


async def main() -> None:
    await ensure_indexes()
    for username, name, role, pw in USERS:
        if not await db.users.find_one({"username": username}):
            await db.users.insert_one({"id": str(uuid.uuid4()), "username": username, "full_name": name,
                                       "role": role, "active": True, "password_hash": hash_password(pw)})
    cat_ids = {}
    for name in CATEGORIES:
        doc = await db.categories.find_one({"name": name})
        if not doc:
            doc = {"id": str(uuid.uuid4()), "name": name, "description": ""}
            await db.categories.insert_one(dict(doc))
        cat_ids[name] = doc["id"]
    now = datetime.now(timezone.utc)
    for sku, bc, name, cat, unit, buy, sell, stock, mn in PRODUCTS:
        if not await db.products.find_one({"sku": sku}):
            await db.products.insert_one({
                "id": str(uuid.uuid4()), "sku": sku, "barcode": bc, "name": name, "category_id": cat_ids[cat],
                "category_name": cat, "unit": unit, "buy_price": buy, "sell_price": sell, "stock": stock,
                "min_stock": mn, "supplier": "", "photo_url": "", "active": True, "created_at": now, "updated_at": now})
    if not await db.settings.find_one({"key": "store"}):
        from models.schemas import Settings
        await db.settings.insert_one({"key": "store", **Settings().model_dump()})
    print("Seed selesai")


if __name__ == "__main__":
    asyncio.run(main())
