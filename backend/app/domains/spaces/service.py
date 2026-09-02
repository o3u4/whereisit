from __future__ import annotations

import sqlite3
from typing import Optional

from app.core.errors import BadRequest, NotFound
from app.core.normalize import norm_text


def require(conn: sqlite3.Connection, space_id: int) -> dict:
    row = conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone()
    if row is None:
        raise NotFound(f"space {space_id} not found")
    return dict(row)


def _parent_of(conn: sqlite3.Connection, space_id: int) -> Optional[int]:
    row = conn.execute("SELECT parent_id FROM spaces WHERE id = ?", (space_id,)).fetchone()
    return row["parent_id"] if row else None


def ancestor_ids(conn: sqlite3.Connection, space_id: int) -> list[int]:
    """Ids from `space_id` up to the root (inclusive of space_id)."""
    chain: list[int] = []
    cur = space_id
    while cur is not None:
        chain.append(cur)
        cur = _parent_of(conn, cur)
    return chain


def subtree(conn: sqlite3.Connection, space_id: int) -> list[dict]:
    """All spaces in the subtree rooted at space_id, deepest first."""
    rows = conn.execute(
        "WITH RECURSIVE sub(id, depth) AS ("
        "  SELECT id, 0 FROM spaces WHERE id = ?"
        "  UNION ALL"
        "  SELECT s.id, sub.depth + 1 FROM spaces s JOIN sub ON s.parent_id = sub.id"
        ") SELECT s.* FROM spaces s JOIN sub ON s.id = sub.id ORDER BY sub.depth DESC, s.ord",
        (space_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def create(conn: sqlite3.Connection, *, parent_id: Optional[int], name: str, type_tag: str, ord_: int) -> dict:
    if parent_id is not None:
        require(conn, parent_id)
    cur = conn.execute(
        "INSERT INTO spaces (parent_id, name, name_norm, ord, type_tag) VALUES (?, ?, ?, ?, ?)",
        (parent_id, name, norm_text(name), ord_, type_tag),
    )
    return require(conn, int(cur.lastrowid))


def update(conn: sqlite3.Connection, space_id: int, *, name=None, type_tag=None, ord_=None, layout_json=None) -> dict:
    require(conn, space_id)
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
        return require(conn, space_id)
    sets.append("updated_at = datetime('now')")
    params.append(space_id)
    conn.execute(f"UPDATE spaces SET {', '.join(sets)} WHERE id = ?", params)
    return require(conn, space_id)


def _children_of(conn: sqlite3.Connection, parent_id: Optional[int]) -> list[int]:
    if parent_id is None:
        rows = conn.execute("SELECT id FROM spaces WHERE parent_id IS NULL ORDER BY ord, id").fetchall()
    else:
        rows = conn.execute(
            "SELECT id FROM spaces WHERE parent_id = ? ORDER BY ord, id", (parent_id,)
        ).fetchall()
    return [r["id"] for r in rows]


def _resequence(conn: sqlite3.Connection, parent_id: Optional[int], ordered_ids: list[int]) -> None:
    conn.executemany(
        "UPDATE spaces SET parent_id = ?, ord = ? WHERE id = ?",
        [(parent_id, pos, sid) for pos, sid in enumerate(ordered_ids)],
    )


def move(conn: sqlite3.Connection, space_id: int, *, parent_id: Optional[int], index: Optional[int]) -> dict:
    require(conn, space_id)
    if parent_id == space_id:
        raise BadRequest("cannot move a space under itself")
    if parent_id is not None:
        require(conn, parent_id)
        if space_id in ancestor_ids(conn, parent_id):
            raise BadRequest("would create a cycle")

    old_parent = _parent_of(conn, space_id)
    if old_parent == parent_id:
        siblings = [s for s in _children_of(conn, parent_id) if s != space_id]
        idx = index if index is not None else len(siblings)
        siblings.insert(min(idx, len(siblings)), space_id)
        _resequence(conn, parent_id, siblings)
        return require(conn, space_id)

    if old_parent is not None:
        _resequence(conn, old_parent, [s for s in _children_of(conn, old_parent) if s != space_id])

    new_siblings = [s for s in _children_of(conn, parent_id) if s != space_id]
    idx = index if index is not None else len(new_siblings)
    new_siblings.insert(min(idx, len(new_siblings)), space_id)
    _resequence(conn, parent_id, new_siblings)
    return require(conn, space_id)


def delete(conn: sqlite3.Connection, space_id: int, *, mode: str = "cascade") -> dict:
    require(conn, space_id)
    if mode not in ("cascade", "move_children"):
        raise BadRequest("mode must be 'cascade' or 'move_children'")

    if mode == "move_children":
        node = require(conn, space_id)
        old_parent = node["parent_id"]
        children = _children_of(conn, space_id)
        if children:
            siblings = [s for s in _children_of(conn, old_parent) if s != space_id]
            _resequence(conn, old_parent, siblings + children)
        removed = [space_id]  # children survive, promoted one level up
    else:
        removed = [r["id"] for r in subtree(conn, space_id)]  # deepest first already

    if removed:
        placeholders = ",".join("?" * len(removed))
        lot_ids = [r["id"] for r in conn.execute(
            f"SELECT id FROM item_lots WHERE space_id IN ({placeholders})", removed
        )]
        conn.execute(f"DELETE FROM item_lots WHERE space_id IN ({placeholders})", removed)
        if lot_ids:
            lp = ",".join("?" * len(lot_ids))
            conn.execute(
                f"DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id IN ({lp})", lot_ids
            )
        sp = ",".join("?" * len(removed))
        conn.execute(f"DELETE FROM attrs WHERE entity_type = 'space' AND entity_id IN ({sp})", removed)
        for sid in removed:  # deepest-first order avoids spaces.parent_id FK violations
            conn.execute("DELETE FROM spaces WHERE id = ?", (sid,))

    return {"deleted": space_id, "removed_ids": removed}


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


def tree(conn: sqlite3.Connection, root_id: Optional[int]) -> list[dict]:
    if root_id is None:
        rows = conn.execute("SELECT * FROM spaces ORDER BY parent_id, ord").fetchall()
        rows = [dict(r) for r in rows]
        roots = [r["id"] for r in rows if r["parent_id"] is None]
        return _build_forest(rows, roots)
    require(conn, root_id)
    rows = [dict(r) for r in subtree(conn, root_id)]  # deepest-first; ordering not needed for build
    return _build_forest(rows, [root_id])


def path(conn: sqlite3.Connection, space_id: int) -> list[dict]:
    """Root -> space chain of {id, name} dicts."""
    require(conn, space_id)
    chain: list[dict] = []
    cur = space_id
    while cur is not None:
        row = conn.execute("SELECT id, parent_id, name FROM spaces WHERE id = ?", (cur,)).fetchone()
        if row is None:
            break
        chain.append({"id": row["id"], "name": row["name"]})
        cur = row["parent_id"]
    return list(reversed(chain))
