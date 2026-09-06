from __future__ import annotations

import re
import sqlite3
from typing import Optional

from app.core.errors import BadRequest, NotFound
from app.core.normalize import norm_text
from app.domains.categories import service as cat_service
from app.domains.spaces.service import require as require_space

_ALIAS_SPLIT = re.compile(r"[，,;；、|]+")

_ITEM_LOT_OUT = """
SELECT l.id AS lot_id, l.def_id, l.space_id, l.qty, l.status,
       l.captured_at, l.created_at, l.updated_at, l.notes,
       d.name AS name, d.unit AS unit, c.name AS category
FROM item_lots l
JOIN item_defs d ON d.id = l.def_id
LEFT JOIN categories c ON c.id = d.category_id
WHERE l.id = ? AND l.owner_id = ? AND d.owner_id = ?
"""


def require_lot(conn: sqlite3.Connection, user_id: int, lot_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM item_lots WHERE id = ? AND owner_id = ?", (lot_id, user_id)
    ).fetchone()
    if row is None:
        raise NotFound(f"lot {lot_id} not found")
    return dict(row)


def require_def(conn: sqlite3.Connection, user_id: int, def_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM item_defs WHERE id = ? AND owner_id = ?", (def_id, user_id)
    ).fetchone()
    if row is None:
        raise NotFound(f"def {def_id} not found")
    return dict(row)


def _category_id(conn: sqlite3.Connection, user_id: int, label: str) -> int:
    label = label.strip()
    n = norm_text(label)
    row = conn.execute(
        "SELECT id FROM categories WHERE parent_id IS NULL AND name_norm = ? AND owner_id = ?",
        (n, user_id),
    ).fetchone()
    if row is not None:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO categories (parent_id, name, name_norm, ord, owner_id) VALUES (NULL, ?, ?, 0, ?)",
        (label, n, user_id),
    )
    return int(cur.lastrowid)


def _def(conn: sqlite3.Connection, user_id: int, name: str, category_id: Optional[int], unit: Optional[str]) -> tuple[int, bool]:
    """Return (def_id, created). Canonical category/unit of an existing def win.
    Names are unique per owner, so two users may each have their own 'HDMI 线'."""
    n = norm_text(name)
    row = conn.execute(
        "SELECT id FROM item_defs WHERE name_norm = ? AND owner_id = ?", (n, user_id)
    ).fetchone()
    if row is not None:
        return row["id"], False
    cur = conn.execute(
        "INSERT INTO item_defs (name, name_norm, category_id, unit, owner_id) VALUES (?, ?, ?, ?, ?)",
        (name.strip(), n, category_id, unit, user_id),
    )
    return int(cur.lastrowid), True


def _sync_aliases(conn: sqlite3.Connection, user_id: int, def_id: int, def_name: str, alias: Optional[str]) -> None:
    if not alias:
        return
    forbidden = {norm_text(def_name)}
    existing = {r["name_norm"] for r in conn.execute(
        "SELECT name_norm FROM item_aliases WHERE def_id = ? AND owner_id = ?", (def_id, user_id)
    )}
    for part in _ALIAS_SPLIT.split(alias):
        text = part.strip()
        n = norm_text(text)
        if not n or n in forbidden or n in existing:
            continue
        existing.add(n)
        conn.execute(
            "INSERT INTO item_aliases (def_id, name, name_norm, owner_id) VALUES (?, ?, ?, ?)",
            (def_id, text, n, user_id),
        )


def _write_def_attrs(conn: sqlite3.Connection, user_id: int, def_id: int, pairs: list[tuple[str, str]]) -> None:
    for key, value in pairs:
        k = key.strip()
        if not k or not value:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO attrs (entity_type, entity_id, attr_key, value_type, value_text, owner_id) "
            "VALUES ('def', ?, ?, 'text', ?, ?)",
            (def_id, k, value.strip(), user_id),
        )


def _present_lot(conn: sqlite3.Connection, user_id: int, def_id: int, space_id: int) -> Optional[dict]:
    row = conn.execute(
        "SELECT id, qty FROM item_lots WHERE def_id = ? AND space_id = ? AND status = 'present' "
        "AND owner_id = ? ORDER BY id LIMIT 1",
        (def_id, space_id, user_id),
    ).fetchone()
    return dict(row) if row else None


def remove(conn: sqlite3.Connection, user_id: int, *, lot_id: int) -> dict:
    """Delete a single presence (lot) and its lot-level attrs (same owner)."""
    require_lot(conn, user_id, lot_id)
    conn.execute(
        "DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id = ? AND owner_id = ?",
        (lot_id, user_id),
    )
    conn.execute("DELETE FROM item_lots WHERE id = ? AND owner_id = ?", (lot_id, user_id))
    return {"removed_id": lot_id}


def merge_defs(conn: sqlite3.Connection, user_id: int, *, keep_id: int, from_id: int) -> dict:
    """Absorb one def into another (both owned by the caller)."""
    keep = require_def(conn, user_id, keep_id)
    require_def(conn, user_id, from_id)
    if keep_id == from_id:
        raise BadRequest("cannot merge a def into itself")

    cur = conn.execute(
        "UPDATE item_lots SET def_id = ? WHERE def_id = ? AND owner_id = ?",
        (keep_id, from_id, user_id),
    )
    lots_moved = cur.rowcount

    coalesced = 0
    for space_id in {
        r["space_id"]
        for r in conn.execute(
            "SELECT space_id FROM item_lots WHERE def_id = ? AND status = 'present' AND owner_id = ?",
            (keep_id, user_id),
        ).fetchall()
    }:
        rows = conn.execute(
            "SELECT id, qty FROM item_lots WHERE def_id = ? AND space_id = ? "
            "AND status = 'present' AND owner_id = ? ORDER BY id",
            (keep_id, space_id, user_id),
        ).fetchall()
        if len(rows) > 1:
            target = rows[0]
            for extra in rows[1:]:
                conn.execute(
                    "UPDATE item_lots SET qty = qty + ? WHERE id = ? AND owner_id = ?",
                    (extra["qty"], target["id"], user_id),
                )
                conn.execute(
                    "DELETE FROM item_lots WHERE id = ? AND owner_id = ?", (extra["id"], user_id)
                )
                conn.execute(
                    "DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id = ? AND owner_id = ?",
                    (extra["id"], user_id),
                )
                coalesced += 1

    aliases_added = 0
    for a in conn.execute(
        "SELECT name, name_norm FROM item_aliases WHERE def_id = ? AND owner_id = ?",
        (from_id, user_id),
    ).fetchall():
        exists = conn.execute(
            "SELECT 1 FROM item_aliases WHERE def_id = ? AND name_norm = ? AND owner_id = ?",
            (keep_id, a["name_norm"], user_id),
        ).fetchone()
        if exists is None:
            conn.execute(
                "INSERT INTO item_aliases (def_id, name, name_norm, owner_id) VALUES (?, ?, ?, ?)",
                (keep_id, a["name"], a["name_norm"], user_id),
            )
            aliases_added += 1

    attrs_added = 0
    for a in conn.execute(
        "SELECT attr_key, value_type, value_text, value_int, value_real, value_bool, uom "
        "FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND owner_id = ?",
        (from_id, user_id),
    ).fetchall():
        cur = conn.execute(
            "INSERT OR IGNORE INTO attrs "
            "(entity_type, entity_id, attr_key, value_type, value_text, value_int, value_real, value_bool, uom, owner_id) "
            "VALUES ('def', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                keep_id,
                a["attr_key"],
                a["value_type"],
                a["value_text"],
                a["value_int"],
                a["value_real"],
                a["value_bool"],
                a["uom"],
                user_id,
            ),
        )
        attrs_added += cur.rowcount

    conn.execute(
        "DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND owner_id = ?",
        (from_id, user_id),
    )
    conn.execute("DELETE FROM item_defs WHERE id = ? AND owner_id = ?", (from_id, user_id))
    return {
        "kept_id": keep_id,
        "kept_name": keep["name"],
        "removed_id": from_id,
        "lots_moved": lots_moved,
        "aliases_added": aliases_added,
        "attrs_added": attrs_added,
        "coalesced": coalesced,
    }


def set_category(conn: sqlite3.Connection, user_id: int, *, def_id: int, category_id: Optional[int]) -> dict:
    if category_id is None:
        raise BadRequest("category_id required")
    require_def(conn, user_id, def_id)
    cat_service.require(conn, user_id, category_id)
    conn.execute(
        "UPDATE item_defs SET category_id = ? WHERE id = ? AND owner_id = ?",
        (category_id, def_id, user_id),
    )
    return {"def_id": def_id, "category_id": category_id}


def set_attr(conn: sqlite3.Connection, user_id: int, *, def_id: int, key: str, value: str) -> dict:
    require_def(conn, user_id, def_id)
    k = key.strip()
    v = value.strip()
    if not k:
        raise BadRequest("attr key required")
    conn.execute(
        "INSERT INTO attrs (entity_type, entity_id, attr_key, value_type, value_text, owner_id) "
        "VALUES ('def', ?, ?, 'text', ?, ?) "
        "ON CONFLICT(entity_type, entity_id, attr_key) "
        "DO UPDATE SET value_text = excluded.value_text, value_type = 'text'",
        (def_id, k, v, user_id),
    )
    return {"def_id": def_id, "attr_key": k, "value": v}


def del_attr(conn: sqlite3.Connection, user_id: int, *, def_id: int, key: str) -> dict:
    require_def(conn, user_id, def_id)
    cur = conn.execute(
        "DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND attr_key = ? AND owner_id = ?",
        (def_id, key.strip(), user_id),
    )
    return {"def_id": def_id, "attr_key": key, "removed": cur.rowcount > 0}


def lot_out(conn: sqlite3.Connection, user_id: int, lot_id: int) -> dict:
    row = conn.execute(_ITEM_LOT_OUT, (lot_id, user_id, user_id)).fetchone()
    if row is None:
        raise NotFound(f"lot {lot_id} not found")
    out = dict(row)
    alias = conn.execute(
        "SELECT name FROM item_aliases WHERE def_id = ? AND owner_id = ? ORDER BY id LIMIT 1",
        (out["def_id"], user_id),
    ).fetchone()
    out["alias"] = alias["name"] if alias else ""
    notes = out["notes"] or ""
    legacy_note: Optional[str] = None
    pairs: list[list[str]] = []
    for a in conn.execute(
        "SELECT attr_key, value_text FROM attrs WHERE entity_type = 'def' AND entity_id = ? "
        "AND value_text IS NOT NULL AND owner_id = ? ORDER BY id",
        (out["def_id"], user_id),
    ).fetchall():
        if a["attr_key"] == "备注":
            legacy_note = a["value_text"]
        else:
            pairs.append([a["attr_key"], a["value_text"]])
    out["attrs"] = pairs
    out["notes"] = notes or legacy_note or ""
    return out


def list_all(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id FROM item_lots WHERE owner_id = ? ORDER BY id", (user_id,)
    ).fetchall()
    return [lot_out(conn, user_id, r["id"]) for r in rows]


def register(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    name: str,
    space_id: int,
    qty: int = 1,
    status: str = "present",
    alias: Optional[str] = None,
    category: Optional[str] = None,
    unit: Optional[str] = None,
    notes: Optional[str] = None,
    attrs: Optional[list[tuple[str, str]]] = None,
    no_merge: bool = False,
) -> dict:
    if qty < 1:
        raise BadRequest("qty must be >= 1")
    require_space(conn, user_id, space_id)

    cat_id = _category_id(conn, user_id, category) if category else None
    def_id, created = _def(conn, user_id, name, cat_id, unit)
    _sync_aliases(conn, user_id, def_id, name, alias)
    if created and attrs:
        _write_def_attrs(conn, user_id, def_id, attrs)

    if status == "present" and not no_merge:
        lot = _present_lot(conn, user_id, def_id, space_id)
        if lot is not None:
            conn.execute(
                "UPDATE item_lots SET qty = qty + ?, status = 'present', "
                "updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
                (qty, lot["id"], user_id),
            )
            return {"lot": lot_out(conn, user_id, lot["id"]), "merged": True}

    cur = conn.execute(
        "INSERT INTO item_lots (def_id, space_id, qty, status, notes, owner_id) VALUES (?, ?, ?, ?, ?, ?)",
        (def_id, space_id, qty, status, notes, user_id),
    )
    return {"lot": lot_out(conn, user_id, int(cur.lastrowid)), "merged": False}


def patch(
    conn: sqlite3.Connection,
    user_id: int,
    lot_id: int,
    *,
    qty: Optional[int] = None,
    status: Optional[str] = None,
    space_id: Optional[int] = None,
    notes: Optional[str] = None,
) -> dict:
    if qty is None and status is None and space_id is None and notes is None:
        raise BadRequest("nothing to update")
    if qty is not None and qty < 1:
        raise BadRequest("qty must be >= 1")

    cur = require_lot(conn, user_id, lot_id)
    if space_id is not None:
        require_space(conn, user_id, space_id)

    new_status = status or cur["status"]
    moving = space_id is not None and space_id != cur["space_id"]
    new_space = space_id if space_id is not None else cur["space_id"]

    if new_status == "present" and moving:
        tgt = _present_lot(conn, user_id, cur["def_id"], space_id)
        if tgt is not None and tgt["id"] != lot_id:
            carry = qty if qty is not None else cur["qty"]
            conn.execute(
                "UPDATE item_lots SET qty = qty + ?, space_id = ?, status = 'present', "
                "updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
                (carry, space_id, tgt["id"], user_id),
            )
            conn.execute(
                "DELETE FROM item_lots WHERE id = ? AND owner_id = ?", (lot_id, user_id)
            )
            conn.execute(
                "DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id = ? AND owner_id = ?",
                (lot_id, user_id),
            )
            return {"lot": lot_out(conn, user_id, tgt["id"]), "merged": True, "removed_id": lot_id}

    sets: list[str] = []
    params: list = []
    if moving:
        sets.append("space_id = ?")
        params.append(space_id)
    if qty is not None:
        sets.append("qty = ?")
        params.append(qty)
    if status is not None:
        sets.append("status = ?")
        params.append(status)
    if notes is not None:
        sets.append("notes = ?")
        params.append(notes)
    if sets:
        sets.append("updated_at = datetime('now')")
        params += [lot_id, user_id]
        conn.execute(f"UPDATE item_lots SET {', '.join(sets)} WHERE id = ? AND owner_id = ?", params)

    if notes is not None:
        conn.execute(
            "DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND attr_key = '备注' AND owner_id = ?",
            (cur["def_id"], user_id),
        )

    return {"lot": lot_out(conn, user_id, lot_id), "merged": False, "removed_id": None}