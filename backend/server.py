import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as FastHTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from lib.db import client, ensure_indexes  # noqa: E402
from routers import auth, users, categories, products, sales, dashboard, purchases  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("wbc")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())
    yield
    client.close()


app = FastAPI(title="WARUNG BU CUCUN POS API", version="1.0.0", lifespan=lifespan)

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"success": True, "message": "WARUNG BU CUCUN POS API", "data": {"version": "1.0.0"}}


# Versioned API: /api/v1/... — add /api/v2 later without breaking v1 clients.
v1 = APIRouter(prefix="/v1")
for module in (auth, users, categories, products, sales, dashboard, purchases):
    v1.include_router(module.router)
api_router.include_router(v1)


# Consistent error envelope: {success:false, message, error}
@app.exception_handler(FastHTTPException)
async def http_error(request: Request, exc: FastHTTPException):
    return JSONResponse(status_code=exc.status_code,
                        content={"success": False, "message": str(exc.detail), "error": f"HTTP_{exc.status_code}"})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    msgs = "; ".join(f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors())
    return JSONResponse(status_code=422, content={"success": False, "message": "Data tidak valid", "error": msgs})


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"success": False, "message": "Terjadi kesalahan server", "error": "INTERNAL"})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the router in the main app — keep last.
app.include_router(api_router)
