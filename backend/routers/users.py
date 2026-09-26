import uuid

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import PERMISSIONS, audit, effective_permissions, hash_password, require_admin, verify_password
from lib.db import db
from models.schemas import PinIn, User, UserCreate, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[User])
async def list_users(_: dict = Depends(require_admin)):
    return [_out(u) for u in await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("username", 1).to_list(500)]


@router.post("", response_model=User)
async def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    username = body.username.lower()
    if await db.users.find_one({"username": username}):
        raise HTTPException(409, "Username sudah dipakai")
    await _check_store(body.store_id)
    doc = {"id": str(uuid.uuid4()), "username": username, "full_name": body.full_name,
           "role": body.role, "active": True, "password_hash": hash_password(body.password), "store_id": body.store_id}
    if body.permissions is not None:
        doc["permissions"] = _clean(body.permissions)
    await db.users.insert_one(doc)
    await audit(admin, "user_create", username)
    return _out(doc)


@router.put("/{id}", response_model=User)
async def update_user(id: str, body: UserUpdate, admin: dict = Depends(require_admin)):
    if id == admin["id"] and (body.role != "admin" or not body.active):
        raise HTTPException(400, "Tidak bisa menurunkan role / menonaktifkan akun sendiri")
    await _check_store(body.store_id)
    update = {"full_name": body.full_name, "role": body.role, "active": body.active, "store_id": body.store_id}
    if body.permissions is not None:
        update["permissions"] = _clean(body.permissions)
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(422, "Password minimal 6 karakter")
        update["password_hash"] = hash_password(body.password)
    doc = await db.users.find_one_and_update({"id": id}, {"$set": update},
                                             projection={"_id": 0, "password_hash": 0}, return_document=True)
    if not doc:
        raise HTTPException(404, "Pengguna tidak ditemukan")
    await audit(admin, "user_update", f"{doc['username']} cabang={body.store_id} izin={','.join(effective_permissions(doc))}")
    return _out(doc)


async def _check_store(store_id: str) -> None:
    if not await db.stores.find_one({"id": store_id, "active": True}):
        raise HTTPException(400, "Cabang tidak ditemukan atau nonaktif")


def _clean(perms: list[str]) -> list[str]:
    unknown = [p for p in perms if p not in PERMISSIONS]
    if unknown:
        raise HTTPException(422, f"Izin tidak dikenal: {', '.join(unknown)}")
    return sorted(set(perms))


def _out(doc: dict) -> User:
    return User(**{**doc, "permissions": effective_permissions(doc), "has_pin": bool(doc.get("pin_hash"))})


@router.put("/me/pin")
async def set_my_pin(body: PinIn, admin: dict = Depends(require_admin)):
    full = await db.users.find_one({"id": admin["id"]})
    if not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(403, "Password salah")
    await db.users.update_one({"id": admin["id"]}, {"$set": {"pin_hash": hash_password(body.pin)}})
    await audit(admin, "pin_set")
    return {"success": True, "message": "PIN persetujuan disimpan"}
