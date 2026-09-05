from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from app.core.errors import BadRequest

FORMAT = "whereisit-catalog"
VERSION = 1

# FTS tables are excluded from export (base-table triggers refill them on import).
def _rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    return [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()]


def export_all(conn: sqlite3.Connection) -> dict:
    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "data": {
            "spaces": _rows(conn, "spaces"),
            "categories": _rows(conn, "categories"),
            "defs": _rows(conn, "item_defs"),
            "aliases": _rows(conn, "item_aliases"),
            "lots": _rows(conn, "item_lots"),
            "attrs": _rows(conn, "attrs"),
        },
    }


def _insert_plain(
    conn: sqlite3.Connection, table: str, count_key: str, rows: list[dict], counts: dict
) -> None:
    for row in rows:
        cols = list(row.keys())
        if not cols:
            continue
        ph = ",".join("?" * len(cols))
        cur = conn.execute(
            f"INSERT OR IGNORE INTO {table} ({','.join(cols)}) VALUES ({ph})",
            [row[c] for c in cols],
        )
        counts[count_key] += cur.rowcount


def _insert_tree(
    conn: sqlite3.Connection, table: str, count_key: str, rows: list[dict], counts: dict
) -> None:
    """Insert spine rows with parent_id deferred so FK order doesn't matter, and
    set parent_id in a second pass only when the referenced parent actually exists."""
    for row in rows:
        base = dict(row)
        base.pop("parent_id", None)
        base["parent_id"] = None
        cols = list(base.keys())
        if not cols or "id" not in base:
            continue
        ph = ",".join("?" * len(cols))
        cur = conn.execute(
            f"INSERT OR IGNORE INTO {table} ({','.join(cols)}) VALUES ({ph})",
            [base[c] for c in cols],
        )
        counts[count_key] += cur.rowcount
    for row in rows:
        pid = row.get("parent_id")
        if pid is None:
            continue
        parent = conn.execute(f"SELECT 1 FROM {table} WHERE id = ?", (pid,)).fetchone()
        if parent is not None:
            conn.execute(f"UPDATE {table} SET parent_id = ? WHERE id = ?", (pid, row["id"]))


def import_data(conn: sqlite3.Connection, payload: dict) -> dict:
    if payload.get("format") != FORMAT:
        raise BadRequest("unsupported backup format")
    if payload.get("version") != VERSION:
        raise BadRequest("unsupported backup version")
    data = payload.get("data") or {}

    counts = {k: 0 for k in ("spaces", "categories", "defs", "aliases", "lots", "attrs")}
    _insert_tree(conn, "spaces", "spaces", data.get("spaces", []), counts)
    _insert_tree(conn, "categories", "categories", data.get("categories", []), counts)
    _insert_plain(conn, "item_defs", "defs", data.get("defs", []), counts)
    _insert_plain(conn, "item_aliases", "aliases", data.get("aliases", []), counts)
    _insert_plain(conn, "item_lots", "lots", data.get("lots", []), counts)
    _insert_plain(conn, "attrs", "attrs", data.get("attrs", []), counts)

    return {
        "spaces_inserted": counts["spaces"],
        "categories_inserted": counts["categories"],
        "defs_inserted": counts["defs"],
        "aliases_inserted": counts["aliases"],
        "lots_inserted": counts["lots"],
        "attrs_inserted": counts["attrs"],
    }