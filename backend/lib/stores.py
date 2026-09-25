"""Multi-cabang foundation. Every product / sale / purchase / stock movement carries `store_id`.
Today everything belongs to the main store; later a user's `store_id` selects their branch."""

import logging
from datetime import datetime, timezone

from lib.db import db

MAIN_STORE_ID = "main"
TAGGED_COLLECTIONS = ("products", "sales", "purchases", "stock_movements")
logger = logging.getLogger("wbc.stores")


def current_store_id(user: dict | None = None) -> str:
    return (user or {}).get("store_id") or MAIN_STORE_ID


async def migrate_stores() -> None:
    """Migration 007_add_store_id: create "Cabang Utama" and tag existing data. Idempotent, never deletes."""
    try:
        await db.stores.update_one(
            {"id": MAIN_STORE_ID},
            {"$setOnInsert": {"id": MAIN_STORE_ID, "code": "UTAMA", "name": "Cabang Utama", "address": "", "phone": "",
                              "active": True, "is_main": True, "created_at": datetime.now(timezone.utc)}},
            upsert=True)
        for coll in TAGGED_COLLECTIONS:
            res = await db[coll].update_many({"store_id": {"$exists": False}}, {"$set": {"store_id": MAIN_STORE_ID}})
            if res.modified_count:
                logger.info("migrate_stores: tagged %d %s", res.modified_count, coll)
        await db.migrations.update_one({"name": "007_add_store_id"},
                                       {"$setOnInsert": {"name": "007_add_store_id", "applied_at": datetime.now(timezone.utc)}},
                                       upsert=True)
    except Exception:
        logger.exception("migrate_stores failed")
