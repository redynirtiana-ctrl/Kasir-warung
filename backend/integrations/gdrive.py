"""Google Drive backup via rclone (https://rclone.org/drive/).

The owner connects Google Drive once on the server with `rclone config` (remote name `gdrive`, scope drive.file) as the
same Linux user that runs the backend. The backend only shells out to rclone (no shell, fixed arguments) — the OAuth
token stays in rclone.conf on the server and is never returned to the browser.

Env (all optional): RCLONE_BIN, RCLONE_CONFIG, GDRIVE_REMOTE (default gdrive), GDRIVE_FOLDER (default WARUNG-BACKUP),
GDRIVE_KEEP (default 30), RCLONE_TIMEOUT_SECONDS (default 300).
"""

import asyncio
import json
import logging
import os
import re
import shutil
from pathlib import Path

logger = logging.getLogger("wbc.gdrive")
_lock = asyncio.Lock()
PREFIX = "wbc-backup-"


def _cfg() -> dict:
    return {
        "bin": os.environ.get("RCLONE_BIN") or shutil.which("rclone") or "",
        "config": os.environ.get("RCLONE_CONFIG") or str(Path.home() / ".config" / "rclone" / "rclone.conf"),
        "remote": os.environ.get("GDRIVE_REMOTE", "gdrive"),
        "folder": os.environ.get("GDRIVE_FOLDER", "WARUNG-BACKUP"),
        "keep": int(os.environ.get("GDRIVE_KEEP", "30")),
        "timeout": int(os.environ.get("RCLONE_TIMEOUT_SECONDS", "300")),
    }


class RcloneError(RuntimeError):
    pass


def _friendly(stderr: str) -> str:
    s = stderr.lower()
    if "didn't find section in config file" in s or "not found in config" in s:
        return "Remote Google Drive belum diatur (jalankan rclone config)"
    if "invalid_grant" in s or "token" in s and ("expired" in s or "revoked" in s):
        return "Izin Google Drive kedaluwarsa/dicabut — ulangi rclone config reconnect"
    if "no such host" in s or "dial tcp" in s or "network is unreachable" in s or "timeout" in s:
        return "Server tidak terhubung ke internet"
    if "storagequotaexceeded" in s or "quota" in s:
        return "Kuota Google Drive penuh"
    if "directory not found" in s or "not found" in s:
        return "Folder Google Drive tidak ditemukan / remote salah — cek rclone config"
    lines = [re.sub(r"^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2} (NOTICE|ERROR|INFO|DEBUG)\s*:\s*", "", ln) for ln in stderr.strip().splitlines()
             if ln.strip() and "config file" not in ln.lower()]
    return (lines[-1] if lines else "rclone gagal")[-300:]


async def _run(*args: str, timeout: int | None = None) -> str:
    c = _cfg()
    if not c["bin"]:
        raise RcloneError("rclone belum terpasang di server")
    cmd = [c["bin"], "--config", c["config"], *args]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout or c["timeout"])
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RcloneError("rclone timeout — koneksi internet lambat?")
    if proc.returncode:
        msg = err.decode("utf-8", "replace")
        logger.warning("rclone %s failed (%s): %s", args[0], proc.returncode, msg[-500:])
        raise RcloneError(_friendly(msg))
    return out.decode("utf-8", "replace")


async def status() -> dict:
    c = _cfg()
    base = {"installed": bool(c["bin"]), "configured": False, "connected": False, "remote": c["remote"],
            "folder": c["folder"], "reason": "", "quota_total": None, "quota_free": None}
    if not c["bin"]:
        return {**base, "reason": "rclone belum terpasang di server"}
    if not Path(c["config"]).is_file():
        return {**base, "reason": "Google Drive belum dihubungkan (rclone config belum dibuat)"}
    try:
        remotes = (await _run("listremotes", timeout=15)).split()
        if f"{c['remote']}:" not in remotes:
            return {**base, "reason": f"Remote '{c['remote']}' belum ada di rclone config"}
        base["configured"] = True
        await _run("lsd", f"{c['remote']}:", "--max-depth", "1", timeout=30)
        base["connected"] = True
        try:
            q = json.loads(await _run("about", f"{c['remote']}:", "--json", timeout=30))
            base["quota_total"], base["quota_free"] = q.get("total"), q.get("free")
        except (RcloneError, ValueError):
            pass  # quota is optional
    except RcloneError as e:
        base["reason"] = str(e)
    return base


async def upload(path: Path) -> dict:
    """Copy one closed backup file to <remote>:<folder>/ and keep the newest `keep` wbc-backup files there."""
    c = _cfg()
    if not path.is_file() or not path.name.startswith(PREFIX):
        raise RcloneError("File backup tidak valid")
    dest = f"{c['remote']}:{c['folder']}"
    async with _lock:
        await _run("copyto", str(path), f"{dest}/{path.name}")
        rows = json.loads(await _run("lsjson", dest, "--files-only", "--no-mimetype", timeout=60))
        names = sorted((r["Name"] for r in rows if r.get("Name", "").startswith(PREFIX) and r["Name"].endswith(".json.gz")),
                       reverse=True)  # timestamped names sort chronologically
        deleted = []
        for name in names[c["keep"]:]:
            await _run("deletefile", f"{dest}/{name}", timeout=60)  # goes to Drive trash (recoverable)
            deleted.append(name)
    return {"uploaded": path.name, "deleted": deleted, "retained": min(len(names), c["keep"])}


async def upload_with_retry(path: Path, attempts: int = 3) -> dict:
    delays = [5, 15]
    for i in range(attempts):
        try:
            return await upload(path)
        except RcloneError as e:
            permanent = any(k in str(e) for k in ("belum", "kedaluwarsa", "penuh", "tidak valid"))
            if permanent or i == attempts - 1:
                raise
            logger.info("gdrive upload retry %s after: %s", i + 1, e)
            await asyncio.sleep(delays[min(i, len(delays) - 1)])
    raise RcloneError("unreachable")
