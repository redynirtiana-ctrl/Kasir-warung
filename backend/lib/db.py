"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [IndexModel([("id", ASCENDING)], name="id", unique=True),
              IndexModel([("username", ASCENDING)], name="username", unique=True)],
    "categories": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                   IndexModel([("name", ASCENDING)], name="name")],
    "products": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("sku", ASCENDING)], name="sku", unique=True),
                 IndexModel([("barcode", ASCENDING)], name="barcode", unique=True, sparse=True),
                 IndexModel([("name", ASCENDING)], name="name"),
                 IndexModel([("category_id", ASCENDING)], name="category_id"),
                 IndexModel([("units.barcode", ASCENDING)], name="unit_barcode", sparse=True)],
    "sales": [IndexModel([("id", ASCENDING)], name="id", unique=True),
              IndexModel([("invoice_no", ASCENDING)], name="invoice_no", unique=True),
              IndexModel([("date", ASCENDING), ("status", ASCENDING)], name="date_status"),
              IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "stock_movements": [IndexModel([("product_id", ASCENDING), ("created_at", DESCENDING)], name="product_created")],
    "audit_logs": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "counters": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "settings": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "suppliers": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("name", ASCENDING)], name="name")],
    "purchases": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("supplier_id", ASCENDING), ("date", DESCENDING)], name="supplier_date"),
                  IndexModel([("date", DESCENDING)], name="date_desc")],
    "returns": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                IndexModel([("ref_id", ASCENDING)], name="ref_id"),
                IndexModel([("type", ASCENDING), ("date", ASCENDING)], name="type_date")],
    "customers": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("member_code", ASCENDING)], name="member_code"), IndexModel([("name", ASCENDING)], name="name")],
    "debts": [IndexModel([("id", ASCENDING)], name="id", unique=True),
              IndexModel([("customer_id", ASCENDING), ("status", ASCENDING)], name="customer_status"),
              IndexModel([("status", ASCENDING), ("due_date", ASCENDING)], name="status_due")],
    "expenses": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("date", DESCENDING)], name="date_desc")],
    "daily_reports": [IndexModel([("date", ASCENDING)], name="date", unique=True)],
    "cron_runs": [IndexModel([("run_id", ASCENDING)], name="run_id", unique=True)],
    "backups": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "stock_opnames": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "product_batches": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                        IndexModel([("dismissed", ASCENDING), ("expiry_date", ASCENDING)], name="dismissed_expiry")],
    "notification_logs": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "secrets": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "shifts": [IndexModel([("id", ASCENDING)], name="id", unique=True),
               IndexModel([("user_id", ASCENDING), ("status", ASCENDING)], name="user_status"),
               IndexModel([("opened_at", DESCENDING)], name="opened_desc")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
