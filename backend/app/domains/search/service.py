from __future__ import annotations

import sqlite3
from typing import Optional

from app.core.errors import BadRequest
from app.domains.search import providers


def search(
    conn: sqlite3.Connection,
    *,
    q: str,
    mode: str = "fuzzy",
    scope_space_id: Optional[int] = None,
    category_id: Optional[int] = None,
) -> dict:
    if mode not in providers.SEARCH_MODES:
        raise BadRequest(f"unknown search mode: {mode}")
    if scope_space_id is not None and mode != "existence":
        raise BadRequest("scope_space_id is only valid for mode=existence")
    if category_id is not None and mode != "category":
        raise BadRequest("category_id is only valid for mode=category")

    fn = providers.get_provider(mode)
    return fn(
        conn,
        q=q,
        scope_space_id=scope_space_id,
        category_id=category_id,
    )