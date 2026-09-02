from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.core.api import ok
from app.db.engine import read, tx
from app.domains.spaces import service
from app.domains.spaces.schemas import SpaceCreate, SpaceMove, SpaceOut, SpaceUpdate

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


@router.get("/tree", response_model=dict)
def read_tree(root_id: Optional[int] = Query(default=None)) -> dict:
    with read() as conn:
        return ok(service.tree(conn, root_id))


@router.get("/{space_id}/path", response_model=dict)
def read_path(space_id: int) -> dict:
    with read() as conn:
        return ok(service.path(conn, space_id))


@router.post("", response_model=dict, status_code=201)
def create_space(payload: SpaceCreate) -> dict:
    with tx() as conn:
        node = service.create(
            conn,
            parent_id=payload.parent_id,
            name=payload.name,
            type_tag=payload.type_tag,
            ord_=payload.ord,
        )
        return ok(SpaceOut(**node).model_dump())


@router.patch("/{space_id}", response_model=dict)
def update_space(space_id: int, payload: SpaceUpdate) -> dict:
    with tx() as conn:
        node = service.update(
            conn,
            space_id,
            name=payload.name,
            type_tag=payload.type_tag,
            ord_=payload.ord,
            layout_json=payload.layout_json,
        )
        return ok(SpaceOut(**node).model_dump())


@router.post("/{space_id}/move", response_model=dict)
def move_space(space_id: int, payload: SpaceMove) -> dict:
    with tx() as conn:
        node = service.move(
            conn, space_id, parent_id=payload.parent_id, index=payload.index
        )
        return ok(SpaceOut(**node).model_dump())


@router.delete("/{space_id}", response_model=dict)
def delete_space(
    space_id: int, mode: str = Query(default="cascade")
) -> dict:
    with tx() as conn:
        return ok(service.delete(conn, space_id, mode=mode))
