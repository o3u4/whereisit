from __future__ import annotations

import sqlite3
from typing import Optional

from app.core.errors import BadRequest, Conflict, NotFound
from app.core.normalize import norm_text


def require(conn: sqlite3.Connection, user_id: int, category_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM categories WHERE id = ? AND owner_id = ?", (category_id, user_id)
    ).fetchone()
    if row is None:
        raise NotFound(f"category {category_id} not found")
    return dict(row)


def list_all(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT c.id, c.parent_id, c.name, c.ord, "
        "(SELECT count(*) FROM item_defs d WHERE d.category_id = c.id AND d.owner_id = c.owner_id) AS item_count "
        "FROM categories c WHERE c.owner_id = ? ORDER BY c.parent_id, c.ord, c.id",
        (user_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "parent_id": r["parent_id"],
            "name": r["name"],
            "item_count": r["item_count"],
        }
        for r in rows
    ]


def create(conn: sqlite3.Connection, user_id: int, *, name: str, parent_id: Optional[int] = None) -> dict:
    name = name.strip()
    if not name:
        raise BadRequest("category name must not be empty")
    if parent_id is not None:
        require(conn, user_id, parent_id)
    n = norm_text(name)
    # find-or-create at the root level (mirror of registration's category path)
    row = conn.execute(
        "SELECT id FROM categories WHERE parent_id IS NULL AND name_norm = ? AND owner_id = ?",
        (n, user_id),
    ).fetchone()
    if row is not None:
        return require(conn, user_id, row["id"])
    cur = conn.execute(
        "INSERT INTO categories (parent_id, name, name_norm, ord, owner_id) VALUES (?, ?, ?, 0, ?)",
        (parent_id, name, n, user_id),
    )
    return require(conn, user_id, int(cur.lastrowid))


def rename(conn: sqlite3.Connection, user_id: int, *, category_id: int, name: str) -> dict:
    require(conn, user_id, category_id)
    name = name.strip()
    if not name:
        raise BadRequest("category name must not be empty")
    conn.execute(
        "UPDATE categories SET name = ?, name_norm = ? WHERE id = ? AND owner_id = ?",
        (name, norm_text(name), category_id, user_id),
    )
    return require(conn, user_id, category_id)


def remove(conn: sqlite3.Connection, user_id: int, *, category_id: int, into_id: Optional[int] = None) -> dict:
    require(conn, user_id, category_id)
    if into_id is not None:
        if into_id == category_id:
            raise BadRequest("cannot merge a category into itself")
        require(conn, user_id, into_id)
        conn.execute(
            "UPDATE item_defs SET category_id = ? WHERE category_id = ? AND owner_id = ?",
            (into_id, category_id, user_id),
        )
    else:
        cnt = conn.execute(
            "SELECT count(*) AS n FROM item_defs WHERE category_id = ? AND owner_id = ?",
            (category_id, user_id),
        ).fetchone()["n"]
        if cnt:
            raise Conflict(f"该分类有 {cnt} 件物品，请选合并到的分类")
    conn.execute("DELETE FROM categories WHERE id = ? AND owner_id = ?", (category_id, user_id))
    return {"removed_id": category_id}