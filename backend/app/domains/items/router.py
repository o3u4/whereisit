from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.api import ok
from app.core.auth import get_current_user
from app.db.engine import read, tx
from app.domains.items import service
from app.domains.items.schemas import DefAttrIn, DefPatchIn, MergeDefsIn, PatchIn, RegisterIn

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("", response_model=dict)
def list_items(user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        return ok(service.list_all(conn, user_id))


@router.post("/register", response_model=dict, status_code=201)
def register(payload: RegisterIn, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(
            service.register(
                conn,
                user_id,
                name=payload.name,
                space_id=payload.space_id,
                qty=payload.qty,
                status=payload.status,
                alias=payload.alias,
                category=payload.category,
                unit=payload.unit,
                notes=payload.notes,
                attrs=[(a.key, a.value) for a in payload.attrs],
                no_merge=payload.no_merge,
            )
        )


@router.patch("/lots/{lot_id}", response_model=dict)
def patch_lot(lot_id: int, payload: PatchIn, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(
            service.patch(
                conn,
                user_id,
                lot_id,
                qty=payload.qty,
                status=payload.status,
                space_id=payload.space_id,
                notes=payload.notes,
            )
        )


@router.delete("/lots/{lot_id}", response_model=dict)
def delete_lot(lot_id: int, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(service.remove(conn, user_id, lot_id=lot_id))


@router.post("/defs/{keep_id}/merge", response_model=dict)
def merge_defs(keep_id: int, payload: MergeDefsIn, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(service.merge_defs(conn, user_id, keep_id=keep_id, from_id=payload.from_id))


@router.patch("/defs/{def_id}", response_model=dict)
def patch_def(def_id: int, payload: DefPatchIn, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        if payload.name is not None:
            return ok(service.rename_def(conn, user_id, def_id=def_id, name=payload.name))
        return ok(service.set_category(conn, user_id, def_id=def_id, category_id=payload.category_id))


@router.put("/defs/{def_id}/attrs", response_model=dict)
def put_def_attr(def_id: int, payload: DefAttrIn, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(service.set_attr(conn, user_id, def_id=def_id, key=payload.key, value=payload.value))


@router.delete("/defs/{def_id}/attrs", response_model=dict)
def delete_def_attr(def_id: int, key: str, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(service.del_attr(conn, user_id, def_id=def_id, key=key))