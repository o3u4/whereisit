from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.api import ok
from app.core.auth import get_current_user
from app.db.engine import read, tx
from app.domains.backup import service
from app.domains.backup.schemas import ImportBody

router = APIRouter(prefix="/api", tags=["backup"])


@router.get("/export", response_model=dict)
def export_data(user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        return ok(service.export_all(conn, user_id))


@router.post("/import", response_model=dict)
def import_data(payload: ImportBody, mode: str = Query("merge"), user_id: int = Depends(get_current_user)) -> dict:
    if mode != "merge":
        return ok({"error": f"mode '{mode}' not supported yet; only 'merge'"})
    with tx() as conn:
        return ok(service.import_data(conn, user_id, payload.model_dump()))