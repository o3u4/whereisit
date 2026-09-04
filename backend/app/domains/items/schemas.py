from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ItemStatus = Literal["present", "lent", "consumed"]


class AttrIn(BaseModel):
    key: str = Field(min_length=1, max_length=60)
    value: str = Field(max_length=500)


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    alias: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default=None, max_length=100)
    unit: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=2000)
    qty: int = 1
    status: ItemStatus = "present"
    space_id: int
    attrs: list[AttrIn] = []


class PatchIn(BaseModel):
    qty: Optional[int] = None
    status: Optional[ItemStatus] = None
    space_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class MergeDefsIn(BaseModel):
    from_id: int


class DefPatchIn(BaseModel):
    category_id: Optional[int] = None
