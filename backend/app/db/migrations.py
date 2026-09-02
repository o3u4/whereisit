from __future__ import annotations

import re
from pathlib import Path

from app.core.config import SCHEMA_DIR
from app.db.engine import connect

_VERSION_RE = re.compile(r"^(\d+)_")


def _available() -> list[tuple[int, Path]]:
    migrations: list[tuple[int, Path]] = []
    for path in sorted(SCHEMA_DIR.glob("*_*.sql")):
        m = _VERSION_RE.match(path.name)
        if m:
            migrations.append((int(m.group(1)), path))
    return migrations


def apply() -> list[int]:
    """Run pending NNN_*.sql migrations in order. Each file executes inside one
    transaction so a failure leaves no partial schema. Returns applied versions."""
    applied_here: list[int] = []
    conn = connect()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
        )
        known = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
        for version, path in _available():
            if version in known:
                continue
            sql = path.read_text(encoding="utf-8")
            conn.executescript(f"BEGIN;\n{sql}\nCOMMIT;")
            conn.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
            applied_here.append(version)
    finally:
        conn.close()
    return applied_here


def current_version() -> int:
    conn = connect()
    try:
        row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
        return int(row["v"]) if row and row["v"] is not None else 0
    except Exception:
        return 0
    finally:
        conn.close()
