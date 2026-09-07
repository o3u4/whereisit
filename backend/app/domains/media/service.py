from __future__ import annotations

import re
import sqlite3
import uuid
from pathlib import Path

from app.core.config import MEDIA_DIR

# Pure file/row work for preview images; deliberately imports nothing from the
# spaces/items domains (they import us for delete-cleanup) to avoid a cycle.
# Ownership/isolation is enforced by the caller and by separate media dirs.

_ENTITY_TYPES = ("space", "lot")
_EXT_RE = re.compile(r"^[a-zA-Z0-9]+$")


def _owner_dir(user_id: int) -> Path:
    return MEDIA_DIR / str(user_id)


def _row(conn: sqlite3.Connection, user_id: int, entity_type: str, entity_id: int):
    return conn.execute(
        "SELECT file_path, mime FROM images "
        "WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
        (user_id, entity_type, entity_id),
    ).fetchone()


def _safe_ext(filename: str) -> str:
    ext = (Path(filename or "").suffix or "").lstrip(".").lower()[:8]
    return ext if _EXT_RE.match(ext) else "img"


def _unlink(user_id: int, file_path: str) -> None:
    try:
        (_owner_dir(user_id) / file_path).unlink(missing_ok=True)
    except OSError:
        pass


def put(conn: sqlite3.Connection, user_id: int, entity_type: str, entity_id: int, filename: str, data: bytes, mime: str | None) -> None:
    if entity_type not in _ENTITY_TYPES:
        raise ValueError(f"unsupported entity_type: {entity_type}")
    old = _row(conn, user_id, entity_type, entity_id)
    if old is not None:
        _unlink(user_id, old["file_path"])
    name = f"{uuid.uuid4().hex}.{_safe_ext(filename)}"
    _owner_dir(user_id).mkdir(parents=True, exist_ok=True)
    (_owner_dir(user_id) / name).write_bytes(data)
    conn.execute(
        "INSERT INTO images (owner_id, entity_type, entity_id, file_path, mime) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(owner_id, entity_type, entity_id) "
        "DO UPDATE SET file_path = excluded.file_path, mime = excluded.mime, created_at = datetime('now')",
        (user_id, entity_type, entity_id, name, mime),
    )


def delete(conn: sqlite3.Connection, user_id: int, entity_type: str, entity_id: int) -> bool:
    row = _row(conn, user_id, entity_type, entity_id)
    if row is None:
        return False
    _unlink(user_id, row["file_path"])
    conn.execute(
        "DELETE FROM images WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
        (user_id, entity_type, entity_id),
    )
    return True


def resolve(conn: sqlite3.Connection, user_id: int, entity_type: str, entity_id: int) -> tuple[Path, str | None] | None:
    row = _row(conn, user_id, entity_type, entity_id)
    if row is None:
        return None
    path = _owner_dir(user_id) / row["file_path"]
    if not path.exists():
        return None
    return path, row["mime"]