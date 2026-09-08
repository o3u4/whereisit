from __future__ import annotations

import sqlite3
from typing import Optional

from app.core.errors import BadRequest, NotFound
from app.core.normalize import norm_text
from app.domains.media import service as media_service


def require(conn: sqlite3.Connection, user_id: int, space_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM spaces WHERE id = ? AND owner_id = ?", (space_id, user_id)
    ).fetchone()
    if row is None:
        raise NotFound(f"space {space_id} not found")
    return dict(row)


def _parent_of(conn: sqlite3.Connection, user_id: int, space_id: int) -> Optional[int]:
    row = conn.execute(
        "SELECT parent_id FROM spaces WHERE id = ? AND owner_id = ?", (space_id, user_id)
    ).fetchone()
    return row["parent_id"] if row else None


def ancestor_ids(conn: sqlite3.Connection, user_id: int, space_id: int) -> list[int]:
    """Ids from `space_id` up to the root (inclusive of space_id)."""
    chain: list[int] = []
    cur = space_id
    while cur is not None:
        chain.append(cur)
        cur = _parent_of(conn, user_id, cur)
    return chain


def subtree(conn: sqlite3.Connection, user_id: int, space_id: int) -> list[dict]:
    """All spaces in the subtree rooted at space_id, deepest first (same owner)."""
    rows = conn.execute(
        "WITH RECURSIVE sub(id, depth) AS ("
        "  SELECT id, 0 FROM spaces WHERE id = ? AND owner_id = ?"
        "  UNION ALL"
        "  SELECT s.id, sub.depth + 1 FROM spaces s JOIN sub ON s.parent_id = sub.id "
        "     WHERE s.owner_id = ?"
        ") SELECT s.* FROM spaces s JOIN sub ON s.id = sub.id ORDER BY sub.depth DESC, s.ord",
        (space_id, user_id, user_id),
    ).fetchall()
    return [dict(r) for r in rows]


def create(conn: sqlite3.Connection, user_id: int, *, parent_id: Optional[int], name: str, type_tag: str, ord_: int) -> dict:
    if parent_id is not None:
        require(conn, user_id, parent_id)
    cur = conn.execute(
        "INSERT INTO spaces (parent_id, name, name_norm, ord, type_tag, owner_id) VALUES (?, ?, ?, ?, ?, ?)",
        (parent_id, name, norm_text(name), ord_, type_tag, user_id),
    )
    return require(conn, user_id, int(cur.lastrowid))


def update(conn: sqlite3.Connection, user_id: int, space_id: int, *, name=None, type_tag=None, ord_=None, layout_json=None) -> dict:
    require(conn, user_id, space_id)
    sets: list[str] = []
    params: list = []
    if name is not None:
        sets += ["name = ?", "name_norm = ?"]
        params += [name, norm_text(name)]
    if type_tag is not None:
        sets.append("type_tag = ?")
        params.append(type_tag)
    if ord_ is not None:
        sets.append("ord = ?")
        params.append(ord_)
    if layout_json is not None:
        sets.append("layout_json = ?")
        params.append(layout_json)
    if not sets:
        return require(conn, user_id, space_id)
    sets.append("updated_at = datetime('now')")
    params += [space_id, user_id]
    conn.execute(f"UPDATE spaces SET {', '.join(sets)} WHERE id = ? AND owner_id = ?", params)
    return require(conn, user_id, space_id)


def _children_of(conn: sqlite3.Connection, user_id: int, parent_id: Optional[int]) -> list[int]:
    if parent_id is None:
        rows = conn.execute(
            "SELECT id FROM spaces WHERE parent_id IS NULL AND owner_id = ? ORDER BY ord, id",
            (user_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id FROM spaces WHERE parent_id = ? AND owner_id = ? ORDER BY ord, id",
            (parent_id, user_id),
        ).fetchall()
    return [r["id"] for r in rows]


def _resequence(conn: sqlite3.Connection, user_id: int, parent_id: Optional[int], ordered_ids: list[int]) -> None:
    conn.executemany(
        "UPDATE spaces SET parent_id = ?, ord = ? WHERE id = ? AND owner_id = ?",
        [(parent_id, pos, sid, user_id) for pos, sid in enumerate(ordered_ids)],
    )


def move(conn: sqlite3.Connection, user_id: int, space_id: int, *, parent_id: Optional[int], index: Optional[int]) -> dict:
    require(conn, user_id, space_id)
    if parent_id == space_id:
        raise BadRequest("cannot move a space under itself")
    if parent_id is not None:
        require(conn, user_id, parent_id)
        if space_id in ancestor_ids(conn, user_id, parent_id):
            raise BadRequest("would create a cycle")

    old_parent = _parent_of(conn, user_id, space_id)
    if old_parent == parent_id:
        siblings = [s for s in _children_of(conn, user_id, parent_id) if s != space_id]
        idx = index if index is not None else len(siblings)
        siblings.insert(min(idx, len(siblings)), space_id)
        _resequence(conn, user_id, parent_id, siblings)
        return require(conn, user_id, space_id)

    if old_parent is not None:
        _resequence(conn, user_id, old_parent, [s for s in _children_of(conn, user_id, old_parent) if s != space_id])

    new_siblings = [s for s in _children_of(conn, user_id, parent_id) if s != space_id]
    idx = index if index is not None else len(new_siblings)
    new_siblings.insert(min(idx, len(new_siblings)), space_id)
    _resequence(conn, user_id, parent_id, new_siblings)
    return require(conn, user_id, space_id)


def delete(conn: sqlite3.Connection, user_id: int, space_id: int, *, mode: str = "cascade") -> dict:
    require(conn, user_id, space_id)
    if mode not in ("cascade", "move_children"):
        raise BadRequest("mode must be 'cascade' or 'move_children'")

    if mode == "move_children":
        node = require(conn, user_id, space_id)
        old_parent = node["parent_id"]
        children = _children_of(conn, user_id, space_id)
        if children:
            siblings = [s for s in _children_of(conn, user_id, old_parent) if s != space_id]
            _resequence(conn, user_id, old_parent, siblings + children)
        removed = [space_id]  # children survive, promoted one level up
    else:
        removed = [r["id"] for r in subtree(conn, user_id, space_id)]  # deepest first already

    lot_ids: list[int] = []
    if removed:
        placeholders = ",".join("?" * len(removed))
        params = removed + [user_id]
        lot_ids = [r["id"] for r in conn.execute(
            f"SELECT id FROM item_lots WHERE space_id IN ({placeholders}) AND owner_id = ?", params
        )]
        lot_params = removed + [user_id]
        conn.execute(
            f"DELETE FROM item_lots WHERE space_id IN ({placeholders}) AND owner_id = ?", lot_params
        )
        if lot_ids:
            lp = ",".join("?" * len(lot_ids))
            lparam = lot_ids + [user_id]
            conn.execute(
                f"DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id IN ({lp}) AND owner_id = ?", lparam
            )
        sp = ",".join("?" * len(removed))
        sparam = removed + [user_id]
        conn.execute(
            f"DELETE FROM attrs WHERE entity_type = 'space' AND entity_id IN ({sp}) AND owner_id = ?", sparam
        )
        for sid in removed:  # deepest-first order avoids spaces.parent_id FK violations
            conn.execute("DELETE FROM spaces WHERE id = ? AND owner_id = ?", (sid, user_id))
        for sid in removed:
            media_service.delete(conn, user_id, "space", sid)
        for lid in lot_ids:
            media_service.delete(conn, user_id, "lot", lid)

    return {"deleted": space_id, "removed_ids": removed, "removed_lots": len(lot_ids)}


def _build_forest(rows: list[dict], roots: list[int]) -> list[dict]:
    by_id = {r["id"]: r for r in rows}
    children_of: dict[Optional[int], list[int]] = {}
    for r in rows:
        children_of.setdefault(r["parent_id"], []).append(r["id"])
    for pid, kids in children_of.items():
        kids.sort(key=lambda sid: (by_id[sid]["ord"], by_id[sid]["id"]))

    def render(node_id: int) -> dict:
        base = {k: v for k, v in by_id[node_id].items()}
        base["children"] = [render(k) for k in children_of.get(node_id, [])]
        return base

    return [render(root) for root in roots]


def tree(conn: sqlite3.Connection, user_id: int, root_id: Optional[int]) -> list[dict]:
    if root_id is None:
        rows = conn.execute(
            "SELECT * FROM spaces WHERE owner_id = ? ORDER BY parent_id, ord", (user_id,)
        ).fetchall()
        rows = [dict(r) for r in rows]
        roots = [r["id"] for r in rows if r["parent_id"] is None]
        return _build_forest(rows, roots)
    require(conn, user_id, root_id)
    rows = [dict(r) for r in subtree(conn, user_id, root_id)]  # deepest-first; ordering not needed for build
    return _build_forest(rows, [root_id])


def ensure_path(conn: sqlite3.Connection, user_id: int, names: list, type_tag: Optional[str] = None) -> int:
    """Resolve a nested path (root-first) to its leaf space id, creating any
    missing segments (mkdir -p), all within this owner. Returns the leaf id.
    When `type_tag` is given it is applied to the leaf node — whether it was just
    created or already existed (so re-adding a space with a different type updates
    it rather than silently keeping the old one)."""
    if not names:
        raise BadRequest("path must not be empty")
    parent: Optional[int] = None
    leaf: Optional[int] = None
    for name in names:
        name = (name or "").strip()
        n = norm_text(name)
        if not n:
            raise BadRequest("path contains an empty segment")
        if parent is None:
            row = conn.execute(
                "SELECT id FROM spaces WHERE parent_id IS NULL AND name_norm = ? AND owner_id = ?",
                (n, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM spaces WHERE parent_id = ? AND name_norm = ? AND owner_id = ?",
                (parent, n, user_id),
            ).fetchone()
        if row is not None:
            node_id = int(row["id"])
        else:
            cur = conn.execute(
                "INSERT INTO spaces (parent_id, name, name_norm, ord, type_tag, owner_id) "
                "VALUES (?, ?, ?, 0, 'generic', ?)",
                (parent, name, n, user_id),
            )
            node_id = int(cur.lastrowid)
        parent = node_id
        leaf = node_id
    if leaf is None:
        raise BadRequest("path must not be empty")
    if type_tag:
        conn.execute(
            "UPDATE spaces SET type_tag = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
            (type_tag, leaf, user_id),
        )
    return leaf


def path(conn: sqlite3.Connection, user_id: int, space_id: int) -> list[dict]:
    """Root -> space chain of {id, name} dicts."""
    require(conn, user_id, space_id)
    chain: list[dict] = []
    cur = space_id
    while cur is not None:
        row = conn.execute(
            "SELECT id, parent_id, name FROM spaces WHERE id = ? AND owner_id = ?", (cur, user_id)
        ).fetchone()
        if row is None:
            break
        chain.append({"id": row["id"], "name": row["name"]})
        cur = row["parent_id"]
    return list(reversed(chain))