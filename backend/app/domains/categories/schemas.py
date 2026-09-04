from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class CategoryOut(BaseModel):
    id: int
    parent_id: Optional[int] = None
    name: str
    item_count: int = 0