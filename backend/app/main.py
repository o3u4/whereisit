from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.errors import ApiError
from app.db import migrations
from app.domains.items.router import router as items_router
from app.domains.search.router import router as search_router
from app.domains.spaces.router import router as spaces_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    migrations.apply()
    yield


app = FastAPI(title="whereisit", version="0.1.0", lifespan=lifespan)

app.include_router(spaces_router)
app.include_router(items_router)
app.include_router(search_router)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": "whereisit", "schema_version": migrations.current_version()}


@app.get("/api/schema-version")
def schema_version() -> dict:
    return {"schema_version": migrations.current_version()}
