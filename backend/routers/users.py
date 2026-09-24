import uuid

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import audit, hash_password, require_admin
from lib.db import db
from models.schemas import User, UserCreate, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[User])
async def list_users(_: dict = Depends(require_admin)):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("username", 1).to_list(500)


@router.post("", response_model=User)
async def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    username = body.username.lower()
    if await db.users.find_one({"username": username}):
        raise HTTPException(409, "Username sudah dipakai")
    doc = {"id": str(uuid.uuid4()), "username": username, "full_name": body.full_name,
           "role": body.role, "active": True, "password_hash": hash_password(body.password)}
    await db.users.insert_one(doc)
    await audit(admin, "user_create", username)
    return User(**doc)


@router.put("/{id}", response_model=User)
async def update_user(id: str, body: UserUpdate, admin: dict = Depends(require_admin)):
    if id == admin["id"] and (body.role != "admin" or not body.active):
        raise HTTPException(400, "Tidak bisa menurunkan role / menonaktifkan akun sendiri")
    update = {"full_name": body.full_name, "role": body.role, "active": body.active}
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(422, "Password minimal 6 karakter")
        update["password_hash"] = hash_password(body.password)
    doc = await db.users.find_one_and_update({"id": id}, {"$set": update},
                                             projection={"_id": 0, "password_hash": 0}, return_document=True)
    if not doc:
        raise HTTPException(404, "Pengguna tidak ditemukan")
    await audit(admin, "user_update", doc["username"])
    return User(**doc)
