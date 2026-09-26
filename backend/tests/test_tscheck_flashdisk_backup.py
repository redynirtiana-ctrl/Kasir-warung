"""Backup-ke-Flashdisk (USB backup) tests: detect drive, copy-to-usb, auto-copy toggle, security.
Run: cd /app/backend && python -m pytest -q -p no:cacheprovider tests/test_tscheck_flashdisk_backup.py
"""

import httpx

BASE = "http://localhost:8001/api/v1"


def _login(user: str, pw: str) -> httpx.Client:
    c = httpx.Client(base_url=BASE, timeout=30.0)
    r = c.post("/auth/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    return c


def test_usb_status_shows_fake_usb_drive():
    admin = _login("admin", "admin123")
    r = admin.get("/backups/usb")
    assert r.status_code == 200, r.text
    body = r.json()
    labels = [d["label"] for d in body["drives"]]
    assert "fake-usb" in labels, body
    drive = next(d for d in body["drives"] if d["label"] == "fake-usb")
    assert drive["free_bytes"] > 0
    assert "auto_copy" in body


def test_kasir_forbidden_on_usb_status():
    kasir = _login("kasir", "kasir123")
    r = kasir.get("/backups/usb")
    assert r.status_code == 403, r.text


def test_backup_now_then_copy_to_usb():
    admin = _login("admin", "admin123")
    b = admin.post("/backups").json()
    assert b["filename"]

    r = admin.post(f"/backups/{b['id']}/copy-to-usb", json={"path": "/tmp/fake-usb"})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["label"] == "fake-usb"
    assert "WARUNG-BACKUP" in res["dest"]
    assert res["size"] == b["size"]

    lst = admin.get("/backups").json()
    row = next(x for x in lst if x["id"] == b["id"])
    assert "fake-usb" in row["usb_copied_to"], row

    admin.delete(f"/backups/{b['id']}")


def test_copy_to_usb_rejects_non_detected_path():
    admin = _login("admin", "admin123")
    b = admin.post("/backups").json()
    try:
        r = admin.post(f"/backups/{b['id']}/copy-to-usb", json={"path": "/etc"})
        assert r.status_code == 400, r.text
    finally:
        admin.delete(f"/backups/{b['id']}")


def test_copy_to_usb_unknown_backup_id_404():
    admin = _login("admin", "admin123")
    r = admin.post("/backups/tscheck-unknown-id-xyz/copy-to-usb", json={"path": "/tmp/fake-usb"})
    assert r.status_code == 404, r.text


def test_auto_copy_toggle_persists_then_reset():
    admin = _login("admin", "admin123")
    before = admin.get("/backups/usb").json()["auto_copy"]

    r_on = admin.put("/backups/usb/auto", json={"auto_copy": True})
    assert r_on.status_code == 200, r_on.text
    assert r_on.json()["auto_copy"] is True

    reread = admin.get("/backups/usb").json()
    assert reread["auto_copy"] is True

    r_off = admin.put("/backups/usb/auto", json={"auto_copy": False})
    assert r_off.status_code == 200, r_off.text
    assert r_off.json()["auto_copy"] is False
    assert admin.get("/backups/usb").json()["auto_copy"] is False

    # restore original state just in case
    admin.put("/backups/usb/auto", json={"auto_copy": before})
