"""Database backup / restore. Backups are gzipped Extended-JSON dumps stored in BACKUP_DIR (default backend/backups)."""

import asyncio
import gzip
import hmac
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from bson import json_util
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from lib.auth import audit, require_admin
from lib.db import db, ensure_indexes
from models.schemas import BackupInfo

router = APIRouter(prefix="/backups", tags=["backup"])
cron_router = APIRouter(prefix="/cron", tags=["cron"])
logger = logging.getLogger("wbc.backup")

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", Path(__file__).parent.parent / "backups"))
SKIP = {"backups", "cron_runs"}
KEEP_AUTO = 14


async def create_backup(source: str, username: str) -> BackupInfo:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    names = [n for n in await db.list_collection_names() if n not in SKIP and not n.startswith("system.")]
    data: dict[str, list] = {}
    for n in names:
        data[n] = await db[n].find({}, {"_id": 0}).to_list(None)
    now = datetime.now(timezone.utc)
    filename = f"wbc-backup-{now.strftime('%Y%m%d-%H%M%S')}-{source}.json.gz"
    payload = json_util.dumps({"app": "warung-bu-cucun", "version": 1, "created_at": now, "collections": data})
    path = BACKUP_DIR / filename
    await asyncio.to_thread(path.write_bytes, gzip.compress(payload.encode()))
    info = BackupInfo(id=str(uuid.uuid4()), filename=filename, size=path.stat().st_size, source=source,
                      collections={k: len(v) for k, v in data.items()}, username=username, created_at=now)
    await db.backups.insert_one(info.model_dump())
    if source == "auto":  # retention
        old = await db.backups.find({"source": "auto"}, {"_id": 0}).sort("created_at", -1).skip(KEEP_AUTO).to_list(None)
        for b in old:
            (BACKUP_DIR / b["filename"]).unlink(missing_ok=True)
            await db.backups.delete_one({"id": b["id"]})
    logger.info("backup created %s (%s bytes)", filename, info.size)
    return info


async def restore_from_bytes(raw: bytes, admin: dict) -> dict[str, int]:
    try:
        doc = json_util.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
        cols = doc["collections"]
        assert doc.get("app") == "warung-bu-cucun" and isinstance(cols, dict)
    except Exception:
        raise HTTPException(400, "File backup tidak valid")
    if not cols.get("users"):
        raise HTTPException(400, "Backup tidak berisi data pengguna — restore dibatalkan")
    await create_backup("pre-restore", admin["username"])  # safety net
    counts = {}
    for name, rows in cols.items():
        if name in SKIP:
            continue
        await db[name].delete_many({})
        if rows:
            await db[name].insert_many(rows)
        counts[name] = len(rows)
    await ensure_indexes()
    await audit(admin, "backup_restore", str(counts))
    return counts


@router.get("", response_model=list[BackupInfo])
async def list_backups(_: dict = Depends(require_admin)):
    return await db.backups.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("", response_model=BackupInfo)
async def backup_now(admin: dict = Depends(require_admin)):
    try:
        info = await create_backup("manual", admin["username"])
    except Exception:
        logger.exception("manual backup failed")
        raise HTTPException(500, "Backup gagal")
    await audit(admin, "backup_create", info.filename)
    return info


@router.get("/{id}/download")
async def download(id: str, _: dict = Depends(require_admin)):
    b = await db.backups.find_one({"id": id})
    if not b or not (BACKUP_DIR / b["filename"]).exists():
        raise HTTPException(404, "File backup tidak ditemukan")
    return FileResponse(BACKUP_DIR / b["filename"], filename=b["filename"], media_type="application/gzip")


@router.post("/{id}/restore")
async def restore_saved(id: str, admin: dict = Depends(require_admin)):
    b = await db.backups.find_one({"id": id})
    if not b or not (BACKUP_DIR / b["filename"]).exists():
        raise HTTPException(404, "File backup tidak ditemukan")
    counts = await restore_from_bytes((BACKUP_DIR / b["filename"]).read_bytes(), admin)
    return {"success": True, "message": "Restore berhasil", "data": counts}


@router.post("/restore-upload")
async def restore_upload(file: UploadFile = File(...), admin: dict = Depends(require_admin)):
    raw = await file.read()
    if len(raw) > 200 * 1024 * 1024:
        raise HTTPException(400, "File terlalu besar")
    counts = await restore_from_bytes(raw, admin)
    return {"success": True, "message": "Restore berhasil", "data": counts}


@router.delete("/{id}")
async def delete_backup(id: str, admin: dict = Depends(require_admin)):
    b = await db.backups.find_one_and_delete({"id": id})
    if not b:
        raise HTTPException(404, "Backup tidak ditemukan")
    (BACKUP_DIR / b["filename"]).unlink(missing_ok=True)
    await audit(admin, "backup_delete", b["filename"])
    return {"success": True, "message": "Backup dihapus"}


async def _auto_job(run_id: str) -> None:
    try:
        await create_backup("auto", "system")
    except Exception:
        logger.exception("auto backup failed (run %s)", run_id)


@cron_router.post("/backup", status_code=202)
async def cron_backup(request: Request):
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
    res = await db.cron_runs.update_one({"run_id": f"backup-{run_id}"}, {"$setOnInsert": {"at": datetime.now(timezone.utc)}}, upsert=True)
    if res.upserted_id is not None:
        asyncio.create_task(_auto_job(run_id))
    return {"success": True, "message": "accepted"}
