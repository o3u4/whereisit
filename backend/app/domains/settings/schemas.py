from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SettingsUpdate(BaseModel):
    # str not Literal so an invalid lang surfaces as our 400 (BadRequest), not a 422.
    lang: Optional[str] = None
    token_enabled: Optional[bool] = None
    registration: Optional[str] = None  # 'auto' (self-signup) | 'manual' (admin-issued)
    theme: Optional[str] = None  # 'apple' | 'flat' | 'pixel'
    llm_base_url: Optional[str] = None  # OpenAI-compatible endpoint ('' clears)
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None  # encrypted at rest; never echoed back