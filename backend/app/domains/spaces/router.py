from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.normalize import norm_text
from app.db.engine import read, tx
from app.domains.items import service as items_service
from app.domains.spaces import service
from app.domains.spaces.schemas import BuildTreeBody, PathIn, SpaceCreate, SpaceMove, SpaceOut, SpaceUpdate

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


def _build_tree_nodes(conn, user_id: int, parent_id: int | None, nodes: list) -> tuple[int, int]:
    """Recursively create spaces + their items under `parent_id` (find-or-create
    per name so it's idempotent). Returns (spaces_created, items_created)."""
    cs = ci = 0
    for node in nodes:
        name = (node.name or "").strip()
        if not name:
            continue
        nn = norm_text(name)
        if parent_id is None:
            row = conn.execute(
                "SELECT id FROM spaces WHERE parent_id IS NULL AND name_norm = ? AND owner_id = ?",
                (nn, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM spaces WHERE parent_id = ? AND name_norm = ? AND owner_id = ?",
                (parent_id, nn, user_id),
            ).fetchone()
        if row is not None:
            sid = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO spaces (parent_id, name, name_norm, ord, type_tag, owner_id) VALUES (?,?,?,0,?,?)",
                (parent_id, name, nn, node.type_tag or "generic", user_id),
            )
            sid = int(cur.lastrowid)
        cs += 1
        s2, i2 = _build_tree_nodes(conn, user_id, sid, node.children or [])
        cs += s2
        ci += i2
        for it in node.items or []:
            iname = (it.name or "").strip()
            if not iname:
                continue
            items_service.register(
                conn,
                user_id,
                name=iname,
                space_id=sid,
                alias=it.alias,
                category=it.category,
                unit=it.unit,
                qty=it.qty,
                status=it.status or "present",
                notes=it.notes,
                attrs=[(str(k), str(v)) for k, v in (it.attrs or [])],
            )
            ci += 1
    return cs, ci


@router.post("/build-tree", response_model=dict, status_code=201)
def build_tree(payload: BuildTreeBody, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        if payload.parent_id is not None:
            service.require(conn, user_id, payload.parent_id)
        spaces, items = _build_tree_nodes(conn, user_id, payload.parent_id, payload.nodes)
    return ok({"created": {"spaces": spaces, "items": items}})


@router.post("/ensure-path", response_model=dict, status_code=201)
def ensure_path(payload: PathIn, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        space_id = service.ensure_path(conn, user_id, payload.names, type_tag=payload.type_tag)
    return ok({"id": space_id, "path": payload.names})


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


@router.post("/{space_id}/to-item", response_model=dict)
def space_to_item(space_id: int, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(service.to_item(conn, user_id, space_id))


@router.delete("/{space_id}", response_model=dict)
def delete_space(
    space_id: int,
    mode: str = Query(default="cascade"),
    user_id: int = Depends(get_current_user),
) -> dict:
    with tx() as conn:
        return ok(service.delete(conn, user_id, space_id, mode=mode))