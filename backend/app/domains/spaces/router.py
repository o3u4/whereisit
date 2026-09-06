from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.api import ok
from app.core.auth import get_current_user
from app.db.engine import read, tx
from app.domains.spaces import service
from app.domains.spaces.schemas import SpaceCreate, SpaceMove, SpaceOut, SpaceUpdate

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


@router.get("/tree", response_model=dict)
def read_tree(
    root_id: Optional[int] = Query(default=None), user_id: int = Depends(get_current_user)
) -> dict:
    with read() as conn:
        return ok(service.tree(conn, user_id, root_id))


@router.get("/{space_id}/path", response_model=dict)
def read_path(space_id: int, user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        return ok(service.path(conn, user_id, space_id))


@router.post("", response_model=dict, status_code=201)
def create_space(payload: SpaceCreate, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        node = service.create(
            conn,
            user_id,
            parent_id=payload.parent_id,
            name=payload.name,
            type_tag=payload.type_tag,
            ord_=payload.ord,
        )
        return ok(SpaceOut(**node).model_dump())


@router.patch("/{space_id}", response_model=dict)
def update_space(space_id: int, payload: SpaceUpdate, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        node = service.update(
            conn,
            user_id,
            space_id,
            name=payload.name,
            type_tag=payload.type_tag,
            ord_=payload.ord,
            layout_json=payload.layout_json,
        )
        return ok(SpaceOut(**node).model_dump())


@router.post("/{space_id}/move", response_model=dict)
def move_space(space_id: int, payload: SpaceMove, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        node = service.move(conn, user_id, space_id, parent_id=payload.parent_id, index=payload.index)
        return ok(SpaceOut(**node).model_dump())


@router.delete("/{space_id}", response_model=dict)
def delete_space(
    space_id: int,
    mode: str = Query(default="cascade"),
    user_id: int = Depends(get_current_user),
) -> dict:
    with tx() as conn:
        return ok(service.delete(conn, user_id, space_id, mode=mode))