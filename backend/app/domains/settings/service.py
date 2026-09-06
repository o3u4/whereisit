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


def get(conn: sqlite3.Connection) -> dict:
    return {
        "lang": _get(conn, "lang", "zh"),
        "token_enabled": token_enabled(conn),
        "lan_url": lan_url(),
    }


def put(conn: sqlite3.Connection, *, lang: Optional[str] = None, token_enabled: Optional[bool] = None) -> dict:
    if lang is not None:
        if lang not in ("zh", "en"):
            raise BadRequest("lang must be 'zh' or 'en'")
        _put(conn, "lang", lang)
    if token_enabled is not None:
        if token_enabled:
            if not has_token(conn):
                raise BadRequest("先设置访问令牌，再开启保护")
            _put(conn, "token_enabled", True)
        else:
            _put(conn, "token_enabled", False)
    return get(conn)


def has_token(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT 1 FROM secrets WHERE key = 'access_token'").fetchone()
    return row is not None


def get_token(conn: sqlite3.Connection) -> Optional[str]:
    """Return the current plaintext token, or None if none exists. Lets an
    authorized session re-show / re-download a token it already created."""
    row = conn.execute("SELECT cipher_blob FROM secrets WHERE key = 'access_token'").fetchone()
    if row is None:
        return None
    return crypto.try_decrypt_secret(row["cipher_blob"])


def _write_token(conn: sqlite3.Connection, token: str) -> None:
    conn.execute(
        "INSERT INTO secrets (key, cipher_blob) VALUES ('access_token', ?) "
        "ON CONFLICT(key) DO UPDATE SET cipher_blob = excluded.cipher_blob, updated_at = datetime('now')",
        (crypto.encrypt_secret(token),),
    )


def ensure_token(conn: sqlite3.Connection) -> str:
    """Stable: return the existing token if one exists, otherwise create it.
    Never rotates an existing token — the operator can re-show/copy/download it."""
    existing = get_token(conn)
    token = existing if existing is not None else _secrets.token_urlsafe(32)
    if existing is None:
        _write_token(conn, token)
    _put(conn, "token_enabled", True)
    return token


def rotate_token(conn: sqlite3.Connection) -> str:
    """Explicitly replace the current token with a brand-new one (old ones die)."""
    token = _secrets.token_urlsafe(32)
    _write_token(conn, token)
    _put(conn, "token_enabled", True)
    return token


def clear_token(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM secrets WHERE key = 'access_token'")
    _put(conn, "token_enabled", False)


def valid_token(conn: sqlite3.Connection, candidate: str) -> bool:
    if not candidate:
        return False
    row = conn.execute("SELECT cipher_blob FROM secrets WHERE key = 'access_token'").fetchone()
    if row is None:
        return False
    stored = crypto.try_decrypt_secret(row["cipher_blob"])
    if stored is None:
        return False
    return hmac.compare_digest(stored, candidate)


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