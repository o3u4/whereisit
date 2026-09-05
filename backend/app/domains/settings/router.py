from __future__ import annotations

from fastapi import APIRouter

from app.core.api import ok
from app.db.engine import read, tx
from app.domains.settings import service
from app.domains.settings.schemas import SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=dict)
def get_settings() -> dict:
    with read() as conn:
        return ok(service.get(conn))


@router.put("", response_model=dict, status_code=200)
def update_settings(payload: SettingsUpdate) -> dict:
    with tx() as conn:
        return ok(service.put(conn, lang=payload.lang, token_enabled=payload.token_enabled))


@router.post("/token", response_model=dict, status_code=201)
def create_token() -> dict:
    """Generate (or rotate) the access token, enable protection, hand it back once."""
    with tx() as conn:
        token = service.generate_token(conn)
    return ok({"token": token})


@router.delete("/token", response_model=dict)
def revoke_token() -> dict:
    with tx() as conn:
        service.clear_token(conn)
    return ok({"revoked": True})