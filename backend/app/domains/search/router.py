from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.core.api import ok
from app.db.engine import read
from app.domains.search import service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=dict)
def search_items(
    q: str = Query(min_length=1, description="搜索词"),
    mode: str = Query(default="fuzzy", description="exact|fuzzy|category|existence"),
    scope_space_id: Optional[int] = Query(default=None),
    category_id: Optional[int] = Query(default=None),
) -> dict:
    with read() as conn:
        return ok(
            service.search(
                conn,
                q=q,
                mode=mode,
                scope_space_id=scope_space_id,
                category_id=category_id,
            )
        )