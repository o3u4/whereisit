from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SpaceCreate(BaseModel):
    parent_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    type_tag: str = Field(default="generic", max_length=40)
    ord: int = Field(default=0, ge=0)


class SpaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    type_tag: Optional[str] = Field(default=None, max_length=40)
    ord: Optional[int] = Field(default=None, ge=0)
    layout_json: Optional[str] = None


class SpaceMove(BaseModel):
    parent_id: Optional[int] = None  # None => becomes a root
    index: Optional[int] = Field(default=None, ge=0)


class PathIn(BaseModel):
    """Segments of a nested path (mkdir -p semantics, from the root)."""
    names: list[str] = Field(min_length=1)


class SpaceOut(BaseModel):
    id: int
    parent_id: Optional[int]
    name: str
    type_tag: str
    ord: int
    layout_json: Optional[str] = None
    created_at: str
    updated_at: str
    children: list["SpaceOut"] = []


SpaceOut.model_rebuild()
