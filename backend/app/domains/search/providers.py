# Search provider seam. A provider owns one search mode: 模糊(fuzzy), 精确(exact),
# 类别(category), 存在性(existence). A future semantic/Vec provider (sqlite-vec)
# just registers itself and callers (router/Hub) stay untouched.
# Every provider is scoped to a user_id (owner_id) for per-user data isolation.

from __future__ import annotations

import sqlite3
from typing import Callable, Optional

from app.core.errors import BadRequest
from app.core.normalize import norm_text
from app.domains.items.service import lot_out as _build_lot
from app.domains.spaces import service as _spaces_service

Conn = sqlite3.Connection

# ---------------------------------------------------------------- shared ----

def _term(t: str) -> str:
    """Quote a token as an FTS literal phrase (trigram), neutralising injection."""
    return '"' + t.replace('"', '""') + '"'


def _norm_terms(q: str) -> list[str]:
    return norm_text(q).split()


def _matches_space(conn: Conn, user_id: int, *, terms: list[str], exact: bool = False) -> list[dict]:
    conds: list[str] = []
    params: list = []
    if exact:
        conds.append("name_norm = ?")
        params.append(" ".join(terms))
    else:
        for t in terms:
            if len(t) >= 3:
                conds.append("id IN (SELECT rowid FROM fts_spaces WHERE name_norm MATCH ?)")
                params.append(_term(t))
            else:
                conds.append("name_norm LIKE ?")
                params.append(f"%{t}%")
    conds.append("owner_id = ?")
    params.append(user_id)
    where = " AND ".join(conds) if conds else "1=0"
    rows = conn.execute(
        f"SELECT id, parent_id, name, type_tag FROM spaces WHERE {where} ORDER BY ord, id",
        params,
    ).fetchall()
    return [dict(r) for r in rows]


def _fuzzy_def_ids(conn: Conn, user_id: int, terms: list[str]) -> set[int]:
    conds: list[str] = []
    params: list = []
    for t in terms:
        if len(t) >= 3:
            m = _term(t)
            conds.append(
                "(d.id IN (SELECT rowid FROM fts_item_defs WHERE name_norm MATCH ?) "
                "OR d.id IN (SELECT def_id FROM item_aliases WHERE id IN "
                "(SELECT rowid FROM fts_item_aliases WHERE name_norm MATCH ?)))"
            )
            params += [m, m]
        else:
            conds.append(
                "(d.name_norm LIKE ? OR EXISTS "
                "(SELECT 1 FROM item_aliases a WHERE a.def_id = d.id AND a.name_norm LIKE ?))"
            )
            params += [f"%{t}%", f"%{t}%"]
    if not conds:
        return set()
    conds.append("d.owner_id = ?")
    params.append(user_id)
    rows = conn.execute(
        "SELECT DISTINCT d.id FROM item_defs d WHERE " + " AND ".join(conds), params
    ).fetchall()
    return {r["id"] for r in rows}


def _exact_def_ids(conn: Conn, user_id: int, joined: str) -> set[int]:
    ids = {r["id"] for r in conn.execute(
        "SELECT id FROM item_defs WHERE name_norm = ? AND owner_id = ?", (joined, user_id)
    ).fetchall()}
    ids |= {r["def_id"] for r in conn.execute(
        "SELECT a.def_id FROM item_aliases a JOIN item_defs d ON d.id = a.def_id "
        "WHERE a.name_norm = ? AND d.owner_id = ?",
        (joined, user_id),
    ).fetchall()}
    return ids


def _lots_of(conn: Conn, user_id: int, def_ids: set[int]) -> list[dict]:
    if not def_ids:
        return []
    ph = ",".join("?" * len(def_ids))
    ordered = tuple(sorted(def_ids))
    rows = conn.execute(
        f"SELECT id FROM item_lots WHERE def_id IN ({ph}) AND owner_id = ? ORDER BY id",
        ordered + (user_id,),
    ).fetchall()
    return [_build_lot(conn, user_id, r["id"]) for r in rows]


def _category_ids(conn: Conn, user_id: int, category_id: Optional[int], norm: str) -> set[int]:
    if category_id is not None:
        rows = conn.execute(
            "WITH RECURSIVE c(id) AS ("
            "  SELECT id FROM categories WHERE id = ? AND owner_id = ?"
            "  UNION ALL"
            "  SELECT x.id FROM categories x JOIN c ON x.parent_id = c.id WHERE x.owner_id = ?"
            ") SELECT id FROM c",
            (category_id, user_id, user_id),
        ).fetchall()
        return {r["id"] for r in rows}
    rows = conn.execute(
        "SELECT id FROM categories WHERE parent_id IS NULL AND name_norm LIKE ? AND owner_id = ?",
        (f"%{norm}%", user_id),
    ).fetchall()
    return {r["id"] for r in rows}


def _lots_in_categories(conn: Conn, user_id: int, cat_ids: set[int]) -> list[dict]:
    if not cat_ids:
        return []
    ph = ",".join("?" * len(cat_ids))
    ordered = tuple(sorted(cat_ids))
    rows = conn.execute(
        f"SELECT id FROM item_lots WHERE owner_id = ? AND def_id IN "
        f"(SELECT id FROM item_defs WHERE owner_id = ? AND category_id IN ({ph})) ORDER BY id",
        (user_id, user_id) + ordered,
    ).fetchall()
    return [_build_lot(conn, user_id, r["id"]) for r in rows]


def _subtree_ids(conn: Conn, user_id: int, space_id: int) -> set[int]:
    return {r["id"] for r in _spaces_service.subtree(conn, user_id, space_id)}


def _existence_lots(conn: Conn, user_id: int, def_ids: set[int], scope_space_id: Optional[int]) -> list[dict]:
    if not def_ids:
        return []
    dph = ",".join("?" * len(def_ids))
    base = (
        "SELECT l.id FROM item_lots l WHERE l.def_id IN ("
        + dph
        + ") AND l.status = 'present' AND l.owner_id = ?"
    )
    scope_clause = ""
    params: list = sorted(def_ids) + [user_id]
    if scope_space_id is not None:
        subtree = sorted(_subtree_ids(conn, user_id, scope_space_id))
        if not subtree:
            return []
        sph = ",".join("?" * len(subtree))
        scope_clause = f" AND l.space_id IN ({sph})"
        params = params + subtree
    sql = base + scope_clause + " ORDER BY l.id"
    rows = conn.execute(sql, params).fetchall()
    return [_build_lot(conn, user_id, r["id"]) for r in rows]


# ------------------------------------------------------------------- modes ----

def search_fuzzy(conn, user_id, *, q, scope_space_id=None, category_id=None) -> dict:
    terms = _norm_terms(q)
    items = _lots_of(conn, user_id, _fuzzy_def_ids(conn, user_id, terms))
    spaces = _matches_space(conn, user_id, terms=terms)
    return {"mode": "fuzzy", "items": items, "spaces": spaces}


def search_exact(conn, user_id, *, q, scope_space_id=None, category_id=None) -> dict:
    joined = " ".join(_norm_terms(q))
    items = _lots_of(conn, user_id, _exact_def_ids(conn, user_id, joined))
    spaces = _matches_space(conn, user_id, terms=[joined], exact=True)
    return {"mode": "exact", "items": items, "spaces": spaces}


def search_category(conn, user_id, *, q, scope_space_id=None, category_id=None) -> dict:
    norm = " ".join(_norm_terms(q))
    items = _lots_in_categories(conn, user_id, _category_ids(conn, user_id, category_id, norm or ""))
    return {"mode": "category", "items": items, "spaces": []}


def search_existence(conn, user_id, *, q, scope_space_id=None, category_id=None) -> dict:
    items = _existence_lots(conn, user_id, _fuzzy_def_ids(conn, user_id, _norm_terms(q)), scope_space_id)
    return {"mode": "existence", "items": items, "spaces": []}


_SEARCH: dict[str, Callable[..., dict]] = {}


def register(name: str, fn: Callable[..., dict]) -> None:
    """Register a search provider under a mode name (seam for future vec search)."""
    _SEARCH[name] = fn


for _name, _fn in {
    "fuzzy": search_fuzzy,
    "exact": search_exact,
    "category": search_category,
    "existence": search_existence,
}.items():
    register(_name, _fn)


def get_provider(mode: str) -> Callable[..., dict]:
    fn = _SEARCH.get(mode)
    if fn is None:
        raise BadRequest(f"unknown search mode: {mode}")
    return fn


SEARCH_MODES: tuple[str, ...] = tuple(_SEARCH)