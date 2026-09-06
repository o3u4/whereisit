from __future__ import annotations

import secrets as _secrets
import sqlite3
from typing import Optional

from app.core import secrets as crypto
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound

ROOT_USER_ID = 1


def get(conn: sqlite3.Connection, user_id: int) -> Optional[dict]:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def get_by_username(conn: sqlite3.Connection, username: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
    ).fetchone()
    return dict(row) if row else None


def is_admin(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    return bool(row and row["is_admin"])


def require_admin(conn: sqlite3.Connection, user_id: int) -> None:
    if not is_admin(conn, user_id):
        raise Forbidden("admin only")


def write_token(conn: sqlite3.Connection, user_id: int, token: str) -> None:
    conn.execute(
        "INSERT INTO user_tokens (user_id, cipher_blob) VALUES (?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET cipher_blob = excluded.cipher_blob, updated_at = datetime('now')",
        (user_id, crypto.encrypt_secret(token)),
    )


def generate_token(conn: sqlite3.Connection, user_id: int) -> str:
    token = _secrets.token_urlsafe(32)
    write_token(conn, user_id, token)
    return token


def list_users(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, username, is_admin, created_at FROM users ORDER BY id"
    ).fetchall()
    return [
        {"id": r["id"], "username": r["username"], "is_admin": bool(r["is_admin"])}
        for r in rows
    ]


def create(conn: sqlite3.Connection, username: str) -> dict:
    username = (username or "").strip()
    if not username:
        raise BadRequest("username must not be empty")
    if get_by_username(conn, username) is not None:
        raise Conflict(f"username '{username}' already exists")
    cur = conn.execute(
        "INSERT INTO users (username, is_admin) VALUES (?, 0)", (username,)
    )
    user_id = int(cur.lastrowid)
    token = generate_token(conn, user_id)
    return {"id": user_id, "username": username, "is_admin": False, "token": token}


def register(conn: sqlite3.Connection, username: str) -> dict:
    """Self-signup on the login gate. Only allowed when the admin has set the
    instance to 'auto' registration; 'manual' (or unset) means admin-issued only."""
    from app.domains.settings import service as settings_service

    if settings_service.registration(conn) != "auto":
        raise Forbidden("请联系管理员发放令牌")
    return create(conn, username)


def clear_token(conn: sqlite3.Connection, target: int) -> bool:
    cur = conn.execute("DELETE FROM user_tokens WHERE user_id = ?", (target,))
    return cur.rowcount > 0


def delete_user(conn: sqlite3.Connection, actor_id: int, target: int) -> dict:
    user = get(conn, target)
    if user is None:
        raise NotFound(f"user {target} not found")
    if target == ROOT_USER_ID:
        raise BadRequest("cannot delete the root user")
    if target == actor_id:
        raise BadRequest("cannot delete yourself")

    # drop all of the user's data, leaf-first (attrs has no FK; lots/aliases
    # cascade from defs/spaces but we clear explicitly to be safe)
    conn.execute("DELETE FROM attrs WHERE owner_id = ?", (target,))
    conn.execute("DELETE FROM item_lots WHERE owner_id = ?", (target,))
    conn.execute("DELETE FROM item_aliases WHERE owner_id = ?", (target,))
    conn.execute("DELETE FROM item_defs WHERE owner_id = ?", (target,))
    conn.execute("DELETE FROM categories WHERE owner_id = ?", (target,))
    conn.execute("DELETE FROM spaces WHERE owner_id = ?", (target,))
    conn.execute("DELETE FROM user_tokens WHERE user_id = ?", (target,))
    conn.execute("DELETE FROM users WHERE id = ?", (target,))
    return {"removed_id": target, "username": user["username"]}