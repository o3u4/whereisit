from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.errors import BadRequest, NotFound
from app.db.engine import read, tx
from app.domains.items import service as items_service
from app.domains.media import service
from app.domains.spaces import service as spaces_service

router = APIRouter(prefix="/api/media", tags=["media"])


@router.put("", response_model=dict, status_code=201)
async def put_media(
    entity_type: str = Query(...),
    entity_id: int = Query(...),
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user),
) -> dict:
    if entity_type not in ("space", "lot"):
        raise BadRequest("entity_type must be 'space' or 'lot'")
    with tx() as conn:
        if entity_type == "space":
            spaces_service.require(conn, user_id, entity_id)
        else:
            items_service.require_lot(conn, user_id, entity_id)
        data = await file.read()
        service.put(conn, user_id, entity_type, entity_id, file.filename or "", data, file.content_type)
    return ok({"entity_type": entity_type, "entity_id": entity_id})


@router.delete("", response_model=dict)
def delete_media(
    entity_type: str = Query(...),
    entity_id: int = Query(...),
    user_id: int = Depends(get_current_user),
) -> dict:
    if entity_type not in ("space", "lot"):
        raise BadRequest("entity_type must be 'space' or 'lot'")
    with tx() as conn:
        removed = service.delete(conn, user_id, entity_type, entity_id)
    return ok({"removed": removed})


@router.get("")
def get_media(
    entity_type: str = Query(...),
    entity_id: int = Query(...),
    user_id: int = Depends(get_current_user),
):
    if entity_type not in ("space", "lot"):
        raise BadRequest("entity_type must be 'space' or 'lot'")
    with read() as conn:
        hit = service.resolve(conn, user_id, entity_type, entity_id)
    if hit is None:
        raise NotFound("no image")
    path, mime = hit
    return FileResponse(path, media_type=mime or "application/octet-stream")