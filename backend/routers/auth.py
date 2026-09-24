from fastapi import APIRouter, Depends, HTTPException, Request, Response

from lib.auth import (COOKIE_NAME, TOKEN_HOURS, audit, check_rate_limit, create_token,
                      get_current_user, record_failure, verify_password)
from lib.db import db
from models.schemas import LoginIn, User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=User)
async def login(body: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    check_rate_limit(ip)
    doc = await db.users.find_one({"username": body.username.lower()}, {"_id": 0})
    if not doc or not doc.get("active", True) or not verify_password(body.password, doc["password_hash"]):
        record_failure(ip)
        raise HTTPException(401, "Username atau password salah")
    response.set_cookie(COOKIE_NAME, create_token(doc["id"], doc["role"]), httponly=True,
                        samesite="lax", max_age=TOKEN_HOURS * 3600, path="/")
    await audit(doc, "login")
    return User(**doc)


@router.post("/logout")
async def logout(response: Response, request: Request):
    try:
        user = await get_current_user(request)
        await audit(user, "logout")
    except HTTPException:
        pass
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"success": True, "message": "Logout berhasil"}


@router.get("/me", response_model=User)
async def me(user: dict = Depends(get_current_user)):
    return User(**user)
