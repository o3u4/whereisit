from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.api import ok
from app.db.engine import read, tx
from app.domains.backup import service
from app.domains.backup.schemas import ImportBody

router = APIRouter(prefix="/api", tags=["backup"])


@router.get("/export", response_model=dict)
def export_data() -> dict:
    with read() as conn:
        return ok(service.export_all(conn))


@router.post("/import", response_model=dict)
def import_data(payload: ImportBody, mode: str = Query("merge")) -> dict:
    if mode != "merge":
        return ok({"error": f"mode '{mode}' not supported yet; only 'merge'"})
    with tx() as conn:
        return ok(service.import_data(conn, payload.model_dump()))