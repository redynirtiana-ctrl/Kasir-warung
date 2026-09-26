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
from routers.sales import get_settings
from integrations import gdrive
from lib.usb import copy_to_drive, detect_drives
from models.schemas import BackupInfo, GdriveStatus, GdriveUploadResult, UsbAutoIn, UsbCopyIn, UsbCopyResult, UsbDrive, UsbStatus

router = APIRouter(prefix="/backups", tags=["backup"])
cron_router = APIRouter(prefix="/cron", tags=["cron"])
logger = logging.getLogger("wbc.backup")

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", Path(__file__).parent.parent / "backups"))
SKIP = {"backups", "cron_runs", "meta"}
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


@router.get("/usb", response_model=UsbStatus)
async def usb_status(_: dict = Depends(require_admin)):
    drives = await asyncio.to_thread(detect_drives)
    return UsbStatus(drives=[UsbDrive(**d) for d in drives], auto_copy=(await get_settings()).usb_backup_auto)


@router.put("/usb/auto", response_model=UsbStatus)
async def usb_auto(body: UsbAutoIn, admin: dict = Depends(require_admin)):
    await db.settings.update_one({"key": "store"}, {"$set": {"usb_backup_auto": body.auto_copy}}, upsert=True)
    await audit(admin, "usb_backup_auto", str(body.auto_copy))
    return await usb_status(admin)


async def _copy(b: dict, path: str) -> UsbCopyResult:
    src = BACKUP_DIR / b["filename"]
    if not src.exists():
        raise HTTPException(404, "File backup tidak ditemukan")
    try:
        res = await asyncio.to_thread(copy_to_drive, src, path)
    except (OSError, PermissionError) as e:
        logger.warning("usb copy failed %s -> %s: %s", b["filename"], path, e)
        raise HTTPException(400, str(e) or "Gagal menyalin ke flashdisk")
    await db.backups.update_one({"id": b["id"]}, {"$addToSet": {"usb_copied_to": res["label"]}})
    return UsbCopyResult(**res)


@router.post("/{id}/copy-to-usb", response_model=UsbCopyResult)
async def copy_backup_to_usb(id: str, body: UsbCopyIn, admin: dict = Depends(require_admin)):
    b = await db.backups.find_one({"id": id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Backup tidak ditemukan")
    res = await _copy(b, body.path)
    await audit(admin, "backup_copy_usb", f"{b['filename']} -> {res.dest}")
    return res


# ---------- Google Drive (rclone) ----------
async def _gdrive_state() -> dict:
    return await db.meta.find_one({"key": "gdrive"}, {"_id": 0}) or {}


@router.get("/gdrive", response_model=GdriveStatus)
async def gdrive_status(_: dict = Depends(require_admin)):
    st, state = await gdrive.status(), await _gdrive_state()
    return GdriveStatus(**st, auto_copy=(await get_settings()).gdrive_backup_auto,
                        last_upload_at=state.get("last_upload_at"), last_error=state.get("last_error", ""))


@router.put("/gdrive/auto", response_model=GdriveStatus)
async def gdrive_auto(body: UsbAutoIn, admin: dict = Depends(require_admin)):
    await db.settings.update_one({"key": "store"}, {"$set": {"gdrive_backup_auto": body.auto_copy}}, upsert=True)
    await audit(admin, "gdrive_backup_auto", str(body.auto_copy))
    return await gdrive_status(admin)


async def _gdrive_upload(b: dict, retry: bool = False) -> GdriveUploadResult:
    src = BACKUP_DIR / b["filename"]
    if not src.exists():
        raise HTTPException(404, "File backup tidak ditemukan")
    try:
        res = await (gdrive.upload_with_retry(src) if retry else gdrive.upload(src))
    except gdrive.RcloneError as e:
        await db.meta.update_one({"key": "gdrive"}, {"$set": {"last_error": str(e), "last_error_at": datetime.now(timezone.utc)}}, upsert=True)
        raise HTTPException(400, str(e))
    await db.backups.update_one({"id": b["id"]}, {"$set": {"gdrive_uploaded": True}})
    await db.meta.update_one({"key": "gdrive"}, {"$set": {"last_upload_at": datetime.now(timezone.utc), "last_error": ""}}, upsert=True)
    return GdriveUploadResult(**res)


@router.post("/{id}/copy-to-gdrive", response_model=GdriveUploadResult)
async def copy_backup_to_gdrive(id: str, admin: dict = Depends(require_admin)):
    b = await db.backups.find_one({"id": id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Backup tidak ditemukan")
    res = await _gdrive_upload(b)
    await audit(admin, "backup_copy_gdrive", b["filename"])
    return res


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
        info = await create_backup("auto", "system")
    except Exception:
        logger.exception("auto backup failed (run %s)", run_id)
        return
    settings = await get_settings()
    if settings.gdrive_backup_auto:
        try:
            await _gdrive_upload(info.model_dump(), retry=True)
            logger.info("auto backup uploaded to Google Drive")
        except Exception:
            logger.exception("auto backup upload to Google Drive failed")
    if not settings.usb_backup_auto:
        return
    drives = await asyncio.to_thread(detect_drives)
    if not drives:
        logger.warning("auto backup: salin ke flashdisk aktif, tetapi tidak ada flashdisk terdeteksi")
    for d in drives:
        try:
            await _copy(info.model_dump(), d["path"])
            logger.info("auto backup copied to %s", d["path"])
        except Exception:
            logger.exception("auto backup copy to %s failed", d["path"])


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
