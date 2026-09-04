from __future__ import annotations

from fastapi import APIRouter

from app.core.api import ok
from app.db.engine import read, tx
from app.domains.items import service
from app.domains.items.schemas import DefPatchIn, MergeDefsIn, PatchIn, RegisterIn

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("", response_model=dict)
def list_items() -> dict:
    with read() as conn:
        return ok(service.list_all(conn))


@router.post("/register", response_model=dict, status_code=201)
def register(payload: RegisterIn) -> dict:
    with tx() as conn:
        return ok(
            service.register(
                conn,
                name=payload.name,
                space_id=payload.space_id,
                qty=payload.qty,
                status=payload.status,
                alias=payload.alias,
                category=payload.category,
                unit=payload.unit,
                notes=payload.notes,
                attrs=[(a.key, a.value) for a in payload.attrs],
            )
        )


@router.patch("/lots/{lot_id}", response_model=dict)
def patch_lot(lot_id: int, payload: PatchIn) -> dict:
    with tx() as conn:
        return ok(
            service.patch(
                conn,
                lot_id,
                qty=payload.qty,
                status=payload.status,
                space_id=payload.space_id,
                notes=payload.notes,
            )
        )


@router.delete("/lots/{lot_id}", response_model=dict)
def delete_lot(lot_id: int) -> dict:
    with tx() as conn:
        return ok(service.remove(conn, lot_id=lot_id))


@router.post("/defs/{keep_id}/merge", response_model=dict)
def merge_defs(keep_id: int, payload: MergeDefsIn) -> dict:
    with tx() as conn:
        return ok(service.merge_defs(conn, keep_id=keep_id, from_id=payload.from_id))


@router.patch("/defs/{def_id}", response_model=dict)
def patch_def(def_id: int, payload: DefPatchIn) -> dict:
    with tx() as conn:
        return ok(service.set_category(conn, def_id=def_id, category_id=payload.category_id))
