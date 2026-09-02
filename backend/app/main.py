from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import migrations


@asynccontextmanager
async def lifespan(app: FastAPI):
    applied = migrations.apply()
    yield


app = FastAPI(title="whereisit", version="0.1.0", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": "whereisit", "schema_version": migrations.current_version()}


@app.get("/api/schema-version")
def schema_version() -> dict:
    return {"schema_version": migrations.current_version()}
