from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core import config
from app.core.auth import auth_middleware
from app.core.errors import ApiError
from app.db import migrations
from app.domains.backup.router import router as backup_router
from app.domains.categories.router import router as categories_router
from app.domains.items.router import router as items_router
from app.domains.search.router import router as search_router
from app.domains.settings.router import router as settings_router
from app.domains.spaces.router import router as spaces_router
from app.domains.users.router import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    migrations.apply()
    yield


app = FastAPI(title="whereisit", version="0.1.0", lifespan=lifespan)

app.middleware("http")(auth_middleware)

app.include_router(spaces_router)
app.include_router(items_router)
app.include_router(search_router)
app.include_router(categories_router)
app.include_router(settings_router)
app.include_router(backup_router)
app.include_router(users_router)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": "whereisit", "schema_version": migrations.current_version()}


@app.get("/api/schema-version")
def schema_version() -> dict:
    return {"schema_version": migrations.current_version()}


# ---- production single-port SPA hosting (no CORS; same origin) -------------
_DIST = config.FRONTEND_DIST
if (_DIST / "index.html").exists():
    if (_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": "not found"})
        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
