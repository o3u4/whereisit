from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.api import ok
from app.core.auth import get_current_user
from app.db.engine import read, tx
from app.domains.categories import service
from app.domains.categories.schemas import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=dict)
def list_categories(user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        return ok(service.list_all(conn, user_id))


@router.post("", response_model=dict, status_code=201)
def create_category(payload: CategoryCreate, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        node = service.create(conn, user_id, name=payload.name, parent_id=payload.parent_id)
        return ok(
            CategoryOut(id=node["id"], parent_id=node["parent_id"], name=node["name"]).model_dump()
        )


@router.patch("/{category_id}", response_model=dict)
def rename_category(category_id: int, payload: CategoryUpdate, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        node = service.rename(conn, user_id, category_id=category_id, name=payload.name)
        return ok(
            CategoryOut(id=node["id"], parent_id=node["parent_id"], name=node["name"]).model_dump()
        )


@router.delete("/{category_id}", response_model=dict)
def delete_category(
    category_id: int,
    into_id: Optional[int] = Query(default=None),
    user_id: int = Depends(get_current_user),
) -> dict:
    with tx() as conn:
        return ok(service.remove(conn, user_id, category_id=category_id, into_id=into_id))