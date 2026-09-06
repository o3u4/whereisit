from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from app.core.errors import BadRequest

FORMAT = "whereisit-catalog"
VERSION = 2

# FTS tables are excluded from export (base-table triggers refill them on import).
# owner_id is scoped to the exporting user on export and forced to the importing
# user on import; global PKs are remapped so two users' id=1 never collide.

_CAT_KEYS = ("spaces", "categories", "defs", "aliases", "lots", "attrs")


def _scoped_rows(conn: sqlite3.Connection, user_id: int, table: str, drop_owner: bool = True) -> list[dict]:
    rows = conn.execute(
        f"SELECT * FROM {table} WHERE owner_id = ? ORDER BY id", (user_id,)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        if drop_owner:
            d.pop("owner_id", None)
        out.append(d)
    return out


def export_all(conn: sqlite3.Connection, user_id: int) -> dict:
    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "data": {
            "spaces": _scoped_rows(conn, user_id, "spaces"),
            "categories": _scoped_rows(conn, user_id, "categories"),
            "defs": _scoped_rows(conn, user_id, "item_defs"),
            "aliases": _scoped_rows(conn, user_id, "item_aliases"),
            "lots": _scoped_rows(conn, user_id, "item_lots"),
            "attrs": _scoped_rows(conn, user_id, "attrs"),
        },
    }


def import_data(conn: sqlite3.Connection, user_id: int, payload: dict) -> dict:
    if payload.get("format") != FORMAT:
        raise BadRequest("unsupported backup format")
    if payload.get("version") != VERSION:
        raise BadRequest(
            f"unsupported backup version ({payload.get('version')}); expected {VERSION}"
        )
    data = payload.get("data") or {}
    counts = {k: 0 for k in _CAT_KEYS}

    def copy(table, rows, copy_cols, count_key, maps: dict[str, dict] | None = None) -> dict:
        """Insert rows with fresh autoincrement ids; returns {old_id: new_id}.
        The `maps` dict translates an old imported FK value to the newly-inserted
        id at insert time (needed for NOT NULL FK columns like item_lots.def_id)."""
        idmap: dict[int, int] = {}
        translation = maps or {}
        cols = ",".join(copy_cols + ["owner_id"])
        ph = ",".join("?" * (len(copy_cols) + 1))
        for row in rows:
            if "id" not in row:
                continue
            values = []
            for c in copy_cols:
                v = row.get(c)
                if c in translation:
                    # missing entry -> None (orphan FK becomes NULL, not a stale id)
                    v = translation[c].get(v)
                values.append(v)
            values.append(user_id)
            cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({ph})", values)
            idmap[int(row["id"])] = int(cur.lastrowid)
            counts[count_key] += 1
        return idmap

    def copy_tree(table, rows, copy_cols, count_key) -> dict:
        """Insert self-referencing tree rows (spaces/categories) with parent_id
        NULL first (fresh ids), then re-link each child to its parent's new id —
        order-independent and immune to cross-user id collisions."""
        idmap: dict[int, int] = {}
        parent_of: dict[int, int] = {}
        cols = ",".join(copy_cols + ["owner_id"])
        ph = ",".join("?" * (len(copy_cols) + 1))
        for row in rows:
            if "id" not in row:
                continue
            values = [row.get(c) for c in copy_cols] + [user_id]
            cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({ph})", values)
            old = int(row["id"])
            idmap[old] = int(cur.lastrowid)
            counts[count_key] += 1
            p = row.get("parent_id")
            if p is not None:
                parent_of[old] = int(p)
        for old_child, old_parent in parent_of.items():
            new_parent = idmap.get(old_parent)
            if new_parent is not None:
                conn.execute(
                    f"UPDATE {table} SET parent_id = ? WHERE id = ?",
                    (new_parent, idmap[old_child]),
                )
        return idmap

    spaces_map = copy_tree(
        "spaces", data.get("spaces", []),
        ["name", "name_norm", "ord", "type_tag", "layout_json", "created_at", "updated_at"], "spaces",
    )

    cats_map = copy_tree(
        "categories", data.get("categories", []),
        ["name", "name_norm", "ord", "created_at"], "categories",
    )

    # defs point at categories (not self-referential) — translate at insert time
    defs_map = copy(
        "item_defs", data.get("defs", []),
        ["name", "name_norm", "category_id", "unit", "notes", "created_at", "updated_at"], "defs",
        maps={"category_id": cats_map},
    )

    copy(
        "item_aliases", data.get("aliases", []),
        ["def_id", "name", "name_norm"], "aliases", maps={"def_id": defs_map},
    )

    lots_map = copy(
        "item_lots", data.get("lots", []),
        ["def_id", "space_id", "qty", "status", "captured_at", "notes", "created_at", "updated_at"],
        "lots", maps={"def_id": defs_map, "space_id": spaces_map},
    )

    # attrs reference space/def/lot ids — remap by type
    entity_maps = {"space": spaces_map, "def": defs_map, "lot": lots_map}
    for row in data.get("attrs", []):
        etype = row.get("entity_type")
        amap = entity_maps.get(etype)
        new_eid = amap.get(int(row["entity_id"])) if amap else None
        if new_eid is None:
            continue  # orphan attr whose entity isn't in this export
        conn.execute(
            "INSERT INTO attrs "
            "(entity_type, entity_id, attr_key, value_type, value_text, value_int, value_real, value_bool, uom, owner_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                etype,
                new_eid,
                row.get("attr_key"),
                row.get("value_type"),
                row.get("value_text"),
                row.get("value_int"),
                row.get("value_real"),
                row.get("value_bool"),
                row.get("uom"),
                user_id,
            ),
        )
        counts["attrs"] += 1

    return {
        "spaces_inserted": counts["spaces"],
        "categories_inserted": counts["categories"],
        "defs_inserted": counts["defs"],
        "aliases_inserted": counts["aliases"],
        "lots_inserted": counts["lots"],
        "attrs_inserted": counts["attrs"],
    }