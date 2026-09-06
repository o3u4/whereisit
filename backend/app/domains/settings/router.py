from __future__ import annotations

from fastapi import APIRouter

from app.core.api import ok
from app.core.errors import NotFound
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


@router.get("/token", response_model=dict)
def get_current_token() -> dict:
    """Re-show the current token (already-created) so the operator can copy /
    download it again — never rotates. 404 if protection was never set up."""
    with read() as conn:
        token = service.get_token(conn)
    if token is None:
        raise NotFound("no access token configured")
    return ok({"token": token})


@router.post("/token", response_model=dict, status_code=200)
def create_token() -> dict:
    """Ensure a token exists and enable protection. Stable: returns the existing
    token if one was already created; never rotates on repeat visits."""
    with tx() as conn:
        token = service.ensure_token(conn)
    return ok({"token": token})


@router.post("/token/replace", response_model=dict, status_code=200)
def replace_token() -> dict:
    """Explicitly rotate to a brand-new token (old tokens stop working)."""
    with tx() as conn:
        token = service.rotate_token(conn)
    return ok({"token": token})


@router.delete("/token", response_model=dict)
def revoke_token() -> dict:
    with tx() as conn:
        service.clear_token(conn)
    return ok({"revoked": True})