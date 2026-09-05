from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ImportBody(BaseModel):
    format: str
    version: int
    exported_at: Optional[str] = None
    # Export JSON data: lists keyed by table name; rows are dicts with explicit ids.
    data: dict[str, list[dict[str, Any]]]