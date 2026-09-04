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
WHERE l.id = ?
"""


def require_lot(conn: sqlite3.Connection, lot_id: int) -> dict:
    row = conn.execute("SELECT * FROM item_lots WHERE id = ?", (lot_id,)).fetchone()
    if row is None:
        raise NotFound(f"lot {lot_id} not found")
    return dict(row)


def require_def(conn: sqlite3.Connection, def_id: int) -> dict:
    row = conn.execute("SELECT * FROM item_defs WHERE id = ?", (def_id,)).fetchone()
    if row is None:
        raise NotFound(f"def {def_id} not found")
    return dict(row)


def _category_id(conn: sqlite3.Connection, label: str) -> int:
    label = label.strip()
    n = norm_text(label)
    row = conn.execute(
        "SELECT id FROM categories WHERE parent_id IS NULL AND name_norm = ?", (n,)
    ).fetchone()
    if row is not None:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO categories (parent_id, name, name_norm, ord) VALUES (NULL, ?, ?, 0)",
        (label, n),
    )
    return int(cur.lastrowid)


def _def(conn: sqlite3.Connection, name: str, category_id: Optional[int], unit: Optional[str]) -> tuple[int, bool]:
    """Return (def_id, created). Canonical category/unit of an existing def win."""
    n = norm_text(name)
    row = conn.execute(
        "SELECT id FROM item_defs WHERE name_norm = ?", (n,)
    ).fetchone()
    if row is not None:
        return row["id"], False
    cur = conn.execute(
        "INSERT INTO item_defs (name, name_norm, category_id, unit) VALUES (?, ?, ?, ?)",
        (name.strip(), n, category_id, unit),
    )
    return int(cur.lastrowid), True


def _sync_aliases(conn: sqlite3.Connection, def_id: int, def_name: str, alias: Optional[str]) -> None:
    if not alias:
        return
    forbidden = {norm_text(def_name)}
    existing = {r["name_norm"] for r in conn.execute(
        "SELECT name_norm FROM item_aliases WHERE def_id = ?", (def_id,)
    )}
    for part in _ALIAS_SPLIT.split(alias):
        text = part.strip()
        n = norm_text(text)
        if not n or n in forbidden or n in existing:
            continue
        existing.add(n)
        conn.execute(
            "INSERT INTO item_aliases (def_id, name, name_norm) VALUES (?, ?, ?)",
            (def_id, text, n),
        )


def _write_def_attrs(conn: sqlite3.Connection, def_id: int, pairs: list[tuple[str, str]]) -> None:
    for key, value in pairs:
        k = key.strip()
        if not k or not value:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO attrs (entity_type, entity_id, attr_key, value_type, value_text) "
            "VALUES ('def', ?, ?, 'text', ?)",
            (def_id, k, value.strip()),
        )


def _present_lot(conn: sqlite3.Connection, def_id: int, space_id: int) -> Optional[dict]:
    row = conn.execute(
        "SELECT id, qty FROM item_lots WHERE def_id = ? AND space_id = ? AND status = 'present' "
        "ORDER BY id LIMIT 1",
        (def_id, space_id),
    ).fetchone()
    return dict(row) if row else None


def remove(conn: sqlite3.Connection, *, lot_id: int) -> dict:
    """Delete a single presence (lot) and its lot-level attrs.

    The def/aliases/category persist even if this was the lot's last presence —
    a def without a presence is just an item type with nowhere. attrs has no FK
    on entity_id, so lot attrs are cleaned manually (mirror of spaces delete)."""
    require_lot(conn, lot_id)
    conn.execute(
        "DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id = ?", (lot_id,)
    )
    conn.execute("DELETE FROM item_lots WHERE id = ?", (lot_id,))
    return {"removed_id": lot_id}


def merge_defs(conn: sqlite3.Connection, *, keep_id: int, from_id: int) -> dict:
    """Absorb one def into another: move its lots/aliases/attrs, then drop it.

    Used to merge duplicates (e.g. same item typed slightly differently). The
    kept def's name/category/unit win; from's aliases (deduped by name_norm) and
    def attrs (deduped by attr_key via UNIQUE) are folded in. Attrs has no FK on
    entity_id, so from's def attrs are cleaned manually before removing the row."""
    keep = require_def(conn, keep_id)
    require_def(conn, from_id)
    if keep_id == from_id:
        raise BadRequest("cannot merge a def into itself")

    cur = conn.execute("UPDATE item_lots SET def_id = ? WHERE def_id = ?", (keep_id, from_id))
    lots_moved = cur.rowcount

    # After re-pointing, the keep def may now hold multiple present lots in the
    # same space (from + keep). Coalesce them: sum qty into the lowest-id row and
    # drop the extras, so a merge "adds quantity" where the same item is duplicated
    # in one place; different places stay separate (multi-location is expected).
    coalesced = 0
    for space_id in {
        r["space_id"]
        for r in conn.execute(
            "SELECT space_id FROM item_lots WHERE def_id = ? AND status = 'present'",
            (keep_id,),
        ).fetchall()
    }:
        rows = conn.execute(
            "SELECT id, qty FROM item_lots WHERE def_id = ? AND space_id = ? "
            "AND status = 'present' ORDER BY id",
            (keep_id, space_id),
        ).fetchall()
        if len(rows) > 1:
            target = rows[0]
            for extra in rows[1:]:
                conn.execute(
                    "UPDATE item_lots SET qty = qty + ? WHERE id = ?",
                    (extra["qty"], target["id"]),
                )
                conn.execute("DELETE FROM item_lots WHERE id = ?", (extra["id"],))
                conn.execute(
                    "DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id = ?",
                    (extra["id"],),
                )
                coalesced += 1

    aliases_added = 0
    for a in conn.execute(
        "SELECT name, name_norm FROM item_aliases WHERE def_id = ?", (from_id,)
    ).fetchall():
        exists = conn.execute(
            "SELECT 1 FROM item_aliases WHERE def_id = ? AND name_norm = ?",
            (keep_id, a["name_norm"]),
        ).fetchone()
        if exists is None:
            conn.execute(
                "INSERT INTO item_aliases (def_id, name, name_norm) VALUES (?, ?, ?)",
                (keep_id, a["name"], a["name_norm"]),
            )
            aliases_added += 1

    attrs_added = 0
    for a in conn.execute(
        "SELECT attr_key, value_type, value_text, value_int, value_real, value_bool, uom "
        "FROM attrs WHERE entity_type = 'def' AND entity_id = ?",
        (from_id,),
    ).fetchall():
        cur = conn.execute(
            "INSERT OR IGNORE INTO attrs "
            "(entity_type, entity_id, attr_key, value_type, value_text, value_int, value_real, value_bool, uom) "
            "VALUES ('def', ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                keep_id,
                a["attr_key"],
                a["value_type"],
                a["value_text"],
                a["value_int"],
                a["value_real"],
                a["value_bool"],
                a["uom"],
            ),
        )
        attrs_added += cur.rowcount

    conn.execute("DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ?", (from_id,))
    conn.execute("DELETE FROM item_defs WHERE id = ?", (from_id,))
    return {
        "kept_id": keep_id,
        "kept_name": keep["name"],
        "removed_id": from_id,
        "lots_moved": lots_moved,
        "aliases_added": aliases_added,
        "attrs_added": attrs_added,
        "coalesced": coalesced,
    }


def set_category(conn: sqlite3.Connection, *, def_id: int, category_id: Optional[int]) -> dict:
    """Move an item type (def) under a different category (def-level)."""
    if category_id is None:
        raise BadRequest("category_id required")
    require_def(conn, def_id)
    cat_service.require(conn, category_id)
    conn.execute("UPDATE item_defs SET category_id = ? WHERE id = ?", (category_id, def_id))
    return {"def_id": def_id, "category_id": category_id}


def set_attr(conn: sqlite3.Connection, *, def_id: int, key: str, value: str) -> dict:
    """Upsert one def-level attribute (item type). Insert order (attr id) is the
    display order: updating keeps the original slot, adding appends at the end."""
    require_def(conn, def_id)
    k = key.strip()
    v = value.strip()
    if not k:
        raise BadRequest("attr key required")
    conn.execute(
        "INSERT INTO attrs (entity_type, entity_id, attr_key, value_type, value_text) "
        "VALUES ('def', ?, ?, 'text', ?) "
        "ON CONFLICT(entity_type, entity_id, attr_key) "
        "DO UPDATE SET value_text = excluded.value_text, value_type = 'text'",
        (def_id, k, v),
    )
    return {"def_id": def_id, "attr_key": k, "value": v}


def del_attr(conn: sqlite3.Connection, *, def_id: int, key: str) -> dict:
    require_def(conn, def_id)
    cur = conn.execute(
        "DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND attr_key = ?",
        (def_id, key.strip()),
    )
    return {"def_id": def_id, "attr_key": key, "removed": cur.rowcount > 0}


def lot_out(conn: sqlite3.Connection, lot_id: int) -> dict:
    row = conn.execute(_ITEM_LOT_OUT, (lot_id,)).fetchone()
    if row is None:
        raise NotFound(f"lot {lot_id} not found")
    out = dict(row)
    alias = conn.execute(
        "SELECT name FROM item_aliases WHERE def_id = ? ORDER BY id LIMIT 1", (out["def_id"],)
    ).fetchone()
    out["alias"] = alias["name"] if alias else ""
    # Notes live on the lot; a legacy def attr "备注" (pre-M4) is folded into the
    # lot note as a fallback so it stops showing as a duplicate row.
    notes = out["notes"] or ""
    legacy_note: Optional[str] = None
    pairs: list[list[str]] = []
    for a in conn.execute(
        "SELECT attr_key, value_text FROM attrs WHERE entity_type = 'def' AND entity_id = ? "
        "AND value_text IS NOT NULL ORDER BY id",
        (out["def_id"],),
    ).fetchall():
        if a["attr_key"] == "备注":
            legacy_note = a["value_text"]
        else:
            pairs.append([a["attr_key"], a["value_text"]])
    out["attrs"] = pairs
    out["notes"] = notes or legacy_note or ""
    return out


def list_all(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT id FROM item_lots ORDER BY id").fetchall()
    return [lot_out(conn, r["id"]) for r in rows]


def register(
    conn: sqlite3.Connection,
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
    require_space(conn, space_id)

    cat_id = _category_id(conn, category) if category else None
    def_id, created = _def(conn, name, cat_id, unit)
    _sync_aliases(conn, def_id, name, alias)
    if created and attrs:
        _write_def_attrs(conn, def_id, attrs)

    # no_merge lets an undo restore rebuild an exact separate lot (no absorbing
    # into an existing same-def present lot), mirroring the pre-delete state.
    if status == "present" and not no_merge:
        lot = _present_lot(conn, def_id, space_id)
        if lot is not None:
            conn.execute(
                "UPDATE item_lots SET qty = qty + ?, status = 'present', "
                "updated_at = datetime('now') WHERE id = ?",
                (qty, lot["id"]),
            )
            return {"lot": lot_out(conn, lot["id"]), "merged": True}

    cur = conn.execute(
        "INSERT INTO item_lots (def_id, space_id, qty, status, notes) VALUES (?, ?, ?, ?, ?)",
        (def_id, space_id, qty, status, notes),
    )
    return {"lot": lot_out(conn, int(cur.lastrowid)), "merged": False}


def patch(
    conn: sqlite3.Connection,
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

    cur = require_lot(conn, lot_id)
    if space_id is not None:
        require_space(conn, space_id)

    new_status = status or cur["status"]
    moving = space_id is not None and space_id != cur["space_id"]
    new_space = space_id if space_id is not None else cur["space_id"]

    # Present lot relocated into a place that already holds a present lot of the
    # same def -> absorb into it (additive), delete the moved row.
    if new_status == "present" and moving:
        tgt = _present_lot(conn, cur["def_id"], space_id)
        if tgt is not None and tgt["id"] != lot_id:
            carry = qty if qty is not None else cur["qty"]
            conn.execute(
                "UPDATE item_lots SET qty = qty + ?, space_id = ?, status = 'present', "
                "updated_at = datetime('now') WHERE id = ?",
                (carry, space_id, tgt["id"]),
            )
            conn.execute("DELETE FROM item_lots WHERE id = ?", (lot_id,))
            conn.execute(
                "DELETE FROM attrs WHERE entity_type = 'lot' AND entity_id = ?", (lot_id,)
            )
            return {"lot": lot_out(conn, tgt["id"]), "merged": True, "removed_id": lot_id}

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
        params.append(lot_id)
        conn.execute(f"UPDATE item_lots SET {', '.join(sets)} WHERE id = ?", params)

    # Notes now live on the lot; drop any legacy def attr "备注" (pre-M4) so the
    # read-time fallback can't silently re-surface an old value after an edit.
    if notes is not None:
        conn.execute(
            "DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND attr_key = '备注'",
            (cur["def_id"],),
        )

    return {"lot": lot_out(conn, lot_id), "merged": False, "removed_id": None}
