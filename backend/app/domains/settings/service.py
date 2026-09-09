from __future__ import annotations

import hmac
import json
import secrets as _secrets
import socket
from typing import Optional

import sqlite3

from app.core import secrets as crypto
from app.core.config import PORT
from app.core.errors import BadRequest


def _get(conn: sqlite3.Connection, key: str, default):
    row = conn.execute("SELECT value_json FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    return json.loads(row["value_json"])


def _put(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute(
        "INSERT INTO settings (key, value_json) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        (key, json.dumps(value)),
    )


def token_enabled(conn: sqlite3.Connection) -> bool:
    return bool(_get(conn, "token_enabled", False))


def _user(conn: sqlite3.Connection, user_id: int) -> Optional[dict]:
    row = conn.execute(
        "SELECT id, username, is_admin FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return dict(row) if row else None


def registration(conn: sqlite3.Connection) -> str:
    return _get(conn, "registration", "manual")


def theme(conn: sqlite3.Connection) -> str:
    return _get(conn, "theme", "apple")


def get(conn: sqlite3.Connection, user_id: int) -> dict:
    u = _user(conn, user_id) or {"username": None, "is_admin": 0}
    return {
        "lang": _get(conn, "lang", "zh"),
        "token_enabled": token_enabled(conn),
        "lan_url": lan_url(),
        "username": u["username"],
        "is_admin": bool(u["is_admin"]),
        "registration": registration(conn),
        "theme": theme(conn),
    }


def put(conn: sqlite3.Connection, user_id: int, *, lang: Optional[str] = None, token_enabled: Optional[bool] = None, registration: Optional[str] = None, theme: Optional[str] = None) -> dict:
    if lang is not None:
        if lang not in ("zh", "en"):
            raise BadRequest("lang must be 'zh' or 'en'")
        _put(conn, "lang", lang)
    if theme is not None:
        if theme not in ("apple", "flat", "pixel"):
            raise BadRequest("theme must be 'apple', 'flat' or 'pixel'")
        _put(conn, "theme", theme)
    if token_enabled is not None:
        if token_enabled:
            if not has_token(conn, user_id):
                raise BadRequest("先设置访问令牌，再开启保护")
            _put(conn, "token_enabled", True)
        else:
            _put(conn, "token_enabled", False)
    if registration is not None:
        if registration not in ("auto", "manual"):
            raise BadRequest("registration must be 'auto' or 'manual'")
        _put(conn, "registration", registration)
    return get(conn, user_id)


def has_token(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute("SELECT 1 FROM user_tokens WHERE user_id = ?", (user_id,)).fetchone()
    return row is not None


def get_token(conn: sqlite3.Connection, user_id: int) -> Optional[str]:
    """Return a user's plaintext token, or None if they have none."""
    row = conn.execute("SELECT cipher_blob FROM user_tokens WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        return None
    return crypto.try_decrypt_secret(row["cipher_blob"])


def _write_token(conn: sqlite3.Connection, user_id: int, token: str) -> None:
    conn.execute(
        "INSERT INTO user_tokens (user_id, cipher_blob) VALUES (?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET cipher_blob = excluded.cipher_blob, updated_at = datetime('now')",
        (user_id, crypto.encrypt_secret(token)),
    )


def ensure_token(conn: sqlite3.Connection, user_id: int) -> str:
    """Stable: return the user's existing token or create one. Never rotates."""
    existing = get_token(conn, user_id)
    token = existing if existing is not None else _secrets.token_urlsafe(32)
    if existing is None:
        _write_token(conn, user_id, token)
    _put(conn, "token_enabled", True)
    return token


def rotate_token(conn: sqlite3.Connection, user_id: int) -> str:
    """Explicitly replace a user's token with a brand-new one (old ones die)."""
    token = _secrets.token_urlsafe(32)
    _write_token(conn, user_id, token)
    _put(conn, "token_enabled", True)
    return token


def clear_token(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("DELETE FROM user_tokens WHERE user_id = ?", (user_id,))
    _put(conn, "token_enabled", False)


def user_id_for_token(conn: sqlite3.Connection, candidate: str) -> Optional[int]:
    """Resolve a Bearer token to its user id, or None if it matches none."""
    if not candidate:
        return None
    for row in conn.execute("SELECT user_id, cipher_blob FROM user_tokens").fetchall():
        stored = crypto.try_decrypt_secret(row["cipher_blob"])
        if stored is not None and hmac.compare_digest(stored, candidate):
            return row["user_id"]
    return None


def lan_url() -> str:
    """host:port reachable from a LAN peer; falls back to loopback."""
    ip = "127.0.0.1"
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except OSError:
        pass
    finally:
        s.close()
    return f"{ip}:{PORT}"