"""Detect flashdisks plugged into the server and copy backups onto them.

Ubuntu Desktop mounts USB drives under /media/<user>/<label> automatically. On Ubuntu Server the udev rule installed by
deploy/install.sh mounts them under /media/warung-usb/<dev>. Only mount points found here are accepted as copy targets
(no arbitrary paths from the client). USB_BACKUP_EXTRA_DIRS (comma-separated) adds extra targets, e.g. a NAS mount.
"""

import os
import shutil
from pathlib import Path

USB_FS = {"vfat", "exfat", "ntfs", "ntfs3", "fuseblk", "msdos"}
USB_ROOTS = ("/media/", "/run/media/", "/mnt/")
DEST_DIR = "WARUNG-BACKUP"
KEEP_ON_USB = 30


def _unescape(p: str) -> str:
    # /proc/mounts escapes space, tab, newline, backslash as octal
    return p.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")


def detect_drives() -> list[dict]:
    paths: list[str] = []
    try:
        with open("/proc/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 3 and parts[2] in USB_FS:
                    mp = _unescape(parts[1])
                    if mp.startswith(USB_ROOTS):
                        paths.append(mp)
    except OSError:
        pass
    paths += [p.strip() for p in os.environ.get("USB_BACKUP_EXTRA_DIRS", "").split(",") if p.strip() and os.path.isdir(p.strip())]
    drives, seen = [], set()
    for p in paths:
        if p in seen:
            continue
        seen.add(p)
        try:
            du = shutil.disk_usage(p)
        except OSError:
            continue
        drives.append({"path": p, "label": Path(p).name or p, "total_bytes": du.total, "free_bytes": du.free,
                       "writable": os.access(p, os.W_OK)})
    return drives


def copy_to_drive(src: Path, drive_path: str) -> dict:
    drive = next((d for d in detect_drives() if d["path"] == drive_path), None)
    if not drive:
        raise FileNotFoundError("Flashdisk tidak ditemukan — pastikan sudah dicolok")
    if not drive["writable"]:
        raise PermissionError("Flashdisk tidak bisa ditulisi (read-only / izin)")
    size = src.stat().st_size
    if drive["free_bytes"] < size + 1024 * 1024:
        raise OSError("Ruang flashdisk tidak cukup")
    dest_dir = Path(drive_path) / DEST_DIR
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / src.name
    tmp = dest.with_suffix(dest.suffix + ".part")
    shutil.copyfile(src, tmp)  # copyfile (no metadata): FAT/exFAT reject chmod/chown
    os.replace(tmp, dest)
    os.sync()  # flush to the stick so it is safe to unplug
    if dest.stat().st_size != size:
        raise OSError("Verifikasi gagal: ukuran file berbeda")
    old = sorted(dest_dir.glob("wbc-backup-*.json.gz"), key=lambda p: p.name, reverse=True)[KEEP_ON_USB:]
    for p in old:
        p.unlink(missing_ok=True)
    return {"label": drive["label"], "dest": str(dest), "size": size}
