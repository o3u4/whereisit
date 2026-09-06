from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.errors import NotFound
from app.db.engine import read, tx
from app.domains.settings import service
from app.domains.settings.schemas import SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=dict)
def get_settings(user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        return ok(service.get(conn, user_id))


@router.put("", response_model=dict, status_code=200)
def update_settings(payload: SettingsUpdate, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        return ok(
            service.put(
                conn,
                user_id,
                lang=payload.lang,
                token_enabled=payload.token_enabled,
                registration=payload.registration,
            )
        )


@router.get("/token", response_model=dict)
def get_current_token(user_id: int = Depends(get_current_user)) -> dict:
    """Re-show the current user's token (already-created) — never rotates."""
    with read() as conn:
        token = service.get_token(conn, user_id)
    if token is None:
        raise NotFound("no access token configured")
    return ok({"token": token})


@router.post("/token", response_model=dict, status_code=200)
def create_token(user_id: int = Depends(get_current_user)) -> dict:
    """Ensure the current user has a token and enable protection. Stable."""
    with tx() as conn:
        token = service.ensure_token(conn, user_id)
    return ok({"token": token})


@router.post("/token/replace", response_model=dict, status_code=200)
def replace_token(user_id: int = Depends(get_current_user)) -> dict:
    """Explicitly rotate the current user's token (old token stops working)."""
    with tx() as conn:
        token = service.rotate_token(conn, user_id)
    return ok({"token": token})


@router.delete("/token", response_model=dict)
def revoke_token(user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        service.clear_token(conn, user_id)
    return ok({"revoked": True})