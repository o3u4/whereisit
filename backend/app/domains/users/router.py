from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.api import ok
from app.core.auth import get_current_user
from app.core.errors import NotFound
from app.db.engine import read, tx
from app.domains.settings import service as settings_service
from app.domains.users import service
from app.domains.users.schemas import UserCreate

router = APIRouter(prefix="/api/admin/users", tags=["users"])
public_router = APIRouter(prefix="/api", tags=["users-auth"])


@public_router.get("/register-policy", response_model=dict)
def register_policy() -> dict:
    with read() as conn:
        return ok({"mode": settings_service.registration(conn)})


@public_router.post("/register", response_model=dict, status_code=201)
def register(payload: UserCreate) -> dict:
    with tx() as conn:
        return ok(service.register(conn, payload.username))


@router.get("", response_model=dict)
def list_users(user_id: int = Depends(get_current_user)) -> dict:
    with read() as conn:
        service.require_admin(conn, user_id)
        return ok({"users": service.list_users(conn)})


@router.post("", response_model=dict, status_code=201)
def create_user(payload: UserCreate, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        service.require_admin(conn, user_id)
        return ok(service.create(conn, payload.username))


@router.post("/{target}/token/replace", response_model=dict, status_code=200)
def rotate_user_token(target: int, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        service.require_admin(conn, user_id)
        if service.get(conn, target) is None:
            raise NotFound(f"user {target} not found")
        token = service.generate_token(conn, target)
        return ok({"token": token})


@router.delete("/{target}/token", response_model=dict)
def delete_user_token(target: int, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        service.require_admin(conn, user_id)
        removed = service.clear_token(conn, target)
        return ok({"revoked": removed})


@router.delete("/{target}", response_model=dict)
def delete_user(target: int, user_id: int = Depends(get_current_user)) -> dict:
    with tx() as conn:
        service.require_admin(conn, user_id)
        return ok(service.delete_user(conn, user_id, target))