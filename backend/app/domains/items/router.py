from __future__ import annotations

from fastapi import APIRouter

from app.core.api import ok
from app.db.engine import read, tx
from app.domains.items import service
from app.domains.items.schemas import PatchIn, RegisterIn

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
            )
        )


@router.delete("/lots/{lot_id}", response_model=dict)
def delete_lot(lot_id: int) -> dict:
    with tx() as conn:
        return ok(service.remove(conn, lot_id=lot_id))
