from __future__ import annotations

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str