from __future__ import annotations

import base64
import json
import re
from typing import Optional

import anthropic
import openai
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from app.core.errors import BadRequest
from app.core.normalize import norm_text
from app.db.engine import read, tx
from app.domains.categories import service as cat_service
from app.domains.items import service as items_service
from app.domains.media import service as media_service
from app.domains.spaces import service as spaces_service

_ALIAS_SPLIT = re.compile(r"[，,;；、|]+")

_STATUS_SYNONYMS = {
    "present": "present", "在库": "present", "有": "present",
    "lent": "lent", "借出": "lent", "出借": "lent", "外借": "lent",
    "consumed": "consumed", "用完": "consumed", "消耗": "consumed", "没了": "consumed",
}


def _coerce_status(v) -> str:
    if v is None:
        return "present"
    s = _STATUS_SYNONYMS.get(str(v).strip().lower())
    if not s:
        raise ValueError(f"状态「{v}」无效，应为 在库/借出/用完")
    return s


def _guess_type(name: str) -> str:
    n = name.strip()
    for kw, t in [("衣柜", "wardrobe"), ("储物柜", "wardrobe"), ("鞋柜", "wardrobe"),
                  ("书桌", "desk"), ("办公桌", "desk"), ("桌面", "desk"),
                  ("抽屉", "drawer"), ("货架", "shelf"), ("置物架", "shelf"),
                  ("隔板", "shelf"), ("架", "shelf"), ("箱", "box"),
                  ("收纳", "box"), ("盒", "box")]:
        if kw in n:
            return t
    return "room"  # 卧室/书房/办公室这类场景默认房间，而非收纳盒

SYSTEM = """You are whereisit's catalog assistant. The user asks you to organize their
item catalog. You NEVER touch data directly: you may call read_tree / find_item /
list_categories to inspect it, then submit_plan to propose an execution plan.
The user reviews and approves the plan before it runs — so plan precisely.

Rules:
- Never guess paths. Inspect first until you know exactly what exists. Reference
  everything by full path from the root, e.g. ["宿舍","书桌","抽屉"]; items by
  name (optionally with `under` = a path).
- Execution tools (plan steps): create / update / remove / category /
  merge_defs / set_image / reorder. One step's arrays are one batch (order
  within an array doesn't matter); steps run strictly 1→N.
- create — new subspaces and/or items (items may carry qty/unit/category/notes/
  status/alias/attrs). update — move subtree or item, patch space (name/type/
  group), patch item (new_name/qty/status/notes/category/unit/alias/attrs_set/
  attrs_del), convert a space into an item. remove — delete spaces/items.
- category — add / rename / merge / remove categories. merge_defs — collapse
  duplicate item types into one. set_image — attach the uploaded photo as a
  preview (one entity). reorder — order the sub-spaces under a path.
- Item status must be one of: present (在库) / lent (借出) / consumed (用完).
- Space type_tag ∈ room/wardrobe/desk/drawer/shelf/box/generic. A top-level scene
  can also carry `group` (家 or 公司), shown as the corner tag on its card.
- Order steps by dependency: create before moves into created paths; moves
  before removing emptied containers; removals last. Batch aggressively; keep
  the step count as small as ordering allows. read tools never appear in a plan.
- Categories: reuse the existing category names from list_categories / the
  category list in your instructions; create a new one only when nothing fits.
- Lending with a return date (e.g. 3天后还) = update: status 'lent' + notes
  mentioning the due date. Deletion only for restructuring (empty/duplicate
  containers), never plain data removal the user didn't ask for.
- Always reply in Chinese unless the user writes in another language. When you
  call submit_plan also write a short plan summary as your reply text. Never ask
  the user questions mid-planning; do the reasonable thing."""

# ------------------------------------------------------------------ plan model ----
class ItemCreate(BaseModel):
    name: str
    at: list[str]
    qty: int = 1
    unit: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    alias: Optional[str] = None
    attrs: Optional[list[list[str]]] = None

class CreateArgs(BaseModel):
    # spaces 可以是字符串路径，也可以是 {path, type_tag?, group?} 对象
    spaces: Optional[list] = None
    items: Optional[list[ItemCreate]] = None

class MoveArgs(BaseModel):
    from_path: list[str]
    to_path: list[str]

class ItemMoveArgs(BaseModel):
    name: str
    under: Optional[list[str]] = None
    to_path: list[str]

class SpacePatch(BaseModel):
    path: list[str]
    name: Optional[str] = None
    type_tag: Optional[str] = None
    group: Optional[str] = None  # 归属 家/公司（layout.group）

class ItemPatch(BaseModel):
    name: str
    under: Optional[list[str]] = None
    new_name: Optional[str] = None
    qty: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    alias: Optional[str] = None
    attrs_set: Optional[list[list[str]]] = None
    attrs_del: Optional[list[str]] = None

class UpdateArgs(BaseModel):
    moves: Optional[list[MoveArgs]] = None
    item_moves: Optional[list[ItemMoveArgs]] = None
    spaces: Optional[list[SpacePatch]] = None
    items: Optional[list[ItemPatch]] = None
    to_items: Optional[list[list[str]]] = None

class ItemRef(BaseModel):
    name: str
    under: Optional[list[str]] = None

class RemoveArgs(BaseModel):
    spaces: Optional[list[list[str]]] = None
    items: Optional[list[ItemRef]] = None

class CategoryRename(BaseModel):
    name: str
    to: str

class CategoryMerge(BaseModel):
    source: str
    into: str

class CategoryOp(BaseModel):
    add: Optional[list[str]] = None
    rename: Optional[list[CategoryRename]] = None
    merge: Optional[list[CategoryMerge]] = None
    remove: Optional[list[str]] = None

class MergeDefsArgs(BaseModel):
    target: str
    sources: list[str]

class SetImageArgs(BaseModel):
    items: Optional[list[ItemRef]] = None
    spaces: Optional[list[list[str]]] = None

class ReorderArgs(BaseModel):
    path: list[str] = []
    spaces: list[str]

_EXEC_ARGS: dict[str, type] = {
    "create": CreateArgs, "update": UpdateArgs, "remove": RemoveArgs,
    "category": CategoryOp, "merge_defs": MergeDefsArgs,
    "set_image": SetImageArgs, "reorder": ReorderArgs,
}


def validate_plan(steps) -> list[dict]:
    """Parse/normalize raw LLM plan JSON into {tool, args} dicts (BadRequest on junk)."""
    out: list[dict] = []
    if not isinstance(steps, list):
        raise BadRequest("方案格式无效")
    for s in steps:
        if not isinstance(s, dict) or s.get("tool") not in _EXEC_ARGS:
            raise BadRequest("方案里有无法识别的操作")
        try:
            args = _EXEC_ARGS[s["tool"]].model_validate(s.get("args") or {})
        except ValidationError:
            raise BadRequest("方案参数无效，请重试")
        out.append({"tool": s["tool"], "args": args.model_dump(exclude_none=True)})
    return out


# ------------------------------------------------------------------ read ----
def _segs(path) -> list[str]:
    if isinstance(path, str):
        return [s.strip() for s in path.replace("\\", "/").split("/") if s.strip()]
    return [str(s).strip() for s in (path or []) if str(s).strip()]


def _p(path) -> str:
    return "/" + "/".join(_segs(path))


def _resolve_space(conn, user_id: int, path) -> Optional[int]:
    """Exact root-first path lookup; None for the root itself. No creation."""
    parent: Optional[int] = None
    segs = _segs(path)
    if not segs:
        return None
    for i, name in enumerate(segs):
        n = norm_text(name)
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
        if row is None:
            raise ValueError("路径不存在：/" + "/".join(segs[: i + 1]))
        parent = int(row["id"])
    return parent


def _space_path(conn, user_id: int, space_id: int) -> str:
    return "/".join(n["name"] for n in spaces_service.path(conn, user_id, space_id))


def _resolve_item(conn, user_id: int, name: str, under=None) -> dict:
    """Find a lot by its def name (exact first, then substring), optionally
    restricted to a subtree. Raises ValueError with a readable message."""
    n = norm_text(name)
    if not n:
        raise ValueError("物品名称为空")
    scope: Optional[int] = None
    if under is not None and _segs(under):
        scope = _resolve_space(conn, user_id, under)
    best: Optional[dict] = None
    for it in items_service.list_all(conn, user_id):
        hay = it["name"].lower()
        if hay != n and n not in hay:
            continue
        if scope is not None and scope not in spaces_service.ancestor_ids(conn, user_id, it["space_id"]):
            continue
        if hay == n:
            return it
        best = best or it
    if best is None:
        prefix = ("在 " + _p(under) + " 下") if under else ""
        raise ValueError(f"{prefix}没有找到物品「{name}」")
    return best


def _resolve_def(conn, user_id: int, name: str) -> dict:
    n = norm_text(name)
    if not n:
        raise ValueError("名称为空")
    row = conn.execute(
        "SELECT * FROM item_defs WHERE owner_id = ? AND name_norm = ?", (user_id, n)
    ).fetchone()
    if row is None:
        rows = conn.execute(
            "SELECT * FROM item_defs WHERE owner_id = ? AND name LIKE ?", (user_id, f"%{name}%")
        ).fetchall()
        if not rows:
            raise ValueError(f"没有找到物品「{name}」")
        row = rows[0]
    return dict(row)


def _resolve_category(conn, user_id: int, name: str) -> dict:
    n = norm_text(name)
    if not n:
        raise ValueError("分类名称为空")
    row = conn.execute(
        "SELECT * FROM categories WHERE owner_id = ? AND name_norm = ?", (user_id, n)
    ).fetchone()
    if row is None:
        raise ValueError(f"没有找到分类「{name}」")
    return dict(row)


def _find_text(conn, user_id: int, name: str, under=None) -> str:
    try:
        it = _resolve_item(conn, user_id, name, under)
        note = f"（{it['notes']}）" if it["notes"] else ""
        return f"找到：{it['name']} ×{it['qty']} [{it['status']}]{note} @ {_space_path(conn, user_id, it['space_id'])}"
    except ValueError as e:
        return str(e)


def _read_tree_text(conn, user_id: int, path) -> str:
    root_id = None
    if path is not None and _segs(path):
        root_id = _resolve_space(conn, user_id, path)
    tree = spaces_service.tree(conn, user_id, root_id)
    lots: dict[int, list[dict]] = {}
    for it in items_service.list_all(conn, user_id):
        lots.setdefault(it["space_id"], []).append(it)
    lines: list[str] = []

    def walk(nodes, depth):
        for n in nodes:
            lines.append("  " * depth + f"- {n['name']}")
            for it in lots.get(n["id"], []):
                note = f"（{it['notes']}）" if it["notes"] else ""
                lines.append("  " * (depth + 1) + f"· {it['name']} ×{it['qty']} [{it['status']}]{note}")
            walk(n["children"], depth + 1)

    walk(tree, 0)
    return "\n".join(lines) or "（空）"


def _category_names_full(conn, user_id: int) -> str:
    rows = conn.execute(
        "SELECT c.name, (SELECT count(*) FROM item_defs d WHERE d.category_id = c.id AND d.owner_id = c.owner_id) n "
        "FROM categories c WHERE c.owner_id = ? ORDER BY n DESC, c.name",
        (user_id,),
    ).fetchall()
    return "、".join(f"{r['name']}（{r['n']} 件）" for r in rows) or "（暂无分类）"


# ------------------------------------------------------------- undo capture ----
def _b64_of(user_id: int, file_path: str) -> str:
    p = MEDIA_DIR / str(user_id) / file_path
    return base64.b64encode(p.read_bytes()).decode() if p.exists() else ""


def _image_snapshot(user_id: int, img_row) -> dict:
    return {"entity_type": img_row["entity_type"], "entity_id": img_row["entity_id"],
            "file_path": img_row["file_path"], "mime": img_row.get("mime"),
            "bytes_b64": _b64_of(user_id, img_row["file_path"])}


def _capture_lot(conn, user_id: int, lot_id: int, ctx: dict) -> None:
    lot = conn.execute(
        "SELECT * FROM item_lots WHERE id = ? AND owner_id = ?", (lot_id, user_id)
    ).fetchone()
    if not lot:
        return
    data = {"lots": [dict(lot)]}
    data["attrs"] = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM attrs WHERE entity_type = 'lot' AND entity_id = ? AND owner_id = ?",
            (lot_id, user_id),
        )
    ]
    img = conn.execute(
        "SELECT file_path, mime FROM images WHERE owner_id = ? AND entity_type = 'lot' AND entity_id = ?",
        (user_id, lot_id),
    ).fetchone()
    if img:
        data["images"] = [_image_snapshot(user_id, img)]
    ctx["undo"].append(data)


def _capture_space(conn, user_id: int, space_id: int, ctx: dict) -> None:
    removed = [r["id"] for r in spaces_service.subtree(conn, user_id, space_id)]
    if not removed:
        return
    ph = ",".join("?" * len(removed))
    spaces = [dict(r) for r in conn.execute(
        f"SELECT * FROM spaces WHERE id IN ({ph}) AND owner_id = ?", removed + [user_id]
    )]
    lots = [dict(r) for r in conn.execute(
        f"SELECT * FROM item_lots WHERE space_id IN ({ph}) AND owner_id = ?", removed + [user_id]
    )]
    lot_ids = [r["id"] for r in lots]
    attrs: list[dict] = []
    attrs += [dict(r) for r in conn.execute(
        f"SELECT * FROM attrs WHERE entity_type = 'space' AND entity_id IN ({ph}) AND owner_id = ?",
        removed + [user_id],
    )]
    if lot_ids:
        lph = ",".join("?" * len(lot_ids))
        attrs += [dict(r) for r in conn.execute(
            f"SELECT * FROM attrs WHERE entity_type = 'lot' AND entity_id IN ({lph}) AND owner_id = ?",
            lot_ids + [user_id],
        )]
    images = [dict(r) for r in conn.execute(
        f"SELECT entity_type, entity_id, file_path, mime FROM images "
        f"WHERE owner_id = ? AND ((entity_type = 'space' AND entity_id IN ({ph})) "
        f"OR (entity_type = 'lot' AND entity_id IN ({ph})))",
        [user_id] + removed + removed,
    )]
    ctx["undo"].append({
        "spaces": sorted(spaces, key=lambda r: r["id"]),
        "lots": sorted(lots, key=lambda r: r["id"]),
        "attrs": attrs,
        "images": [_image_snapshot(user_id, i) for i in images],
    })


def _lot_patch_op(conn, user_id: int, lot_id: int) -> dict | None:
    r = conn.execute(
        "SELECT qty, status, space_id, notes FROM item_lots WHERE id = ? AND owner_id = ?",
        (lot_id, user_id),
    ).fetchone()
    if not r:
        return None
    return {"op": "patch_lot", "lot_id": lot_id,
            "old": {"qty": r["qty"], "status": r["status"], "space_id": r["space_id"], "notes": r["notes"]}}


def _space_patch_op(conn, user_id: int, space_id: int) -> dict | None:
    r = conn.execute(
        "SELECT name, type_tag, parent_id, layout_json FROM spaces WHERE id = ? AND owner_id = ?",
        (space_id, user_id),
    ).fetchone()
    if not r:
        return None
    return {"op": "patch_space", "space_id": space_id,
            "old": {"name": r["name"], "type_tag": r["type_tag"],
                    "parent_id": r["parent_id"], "layout_json": r["layout_json"]}}


def _def_patch_op(conn, user_id: int, def_id: int) -> dict | None:
    r = conn.execute(
        "SELECT name, unit FROM item_defs WHERE id = ? AND owner_id = ?", (def_id, user_id)
    ).fetchone()
    if not r:
        return None
    return {"op": "patch_def", "def_id": def_id, "old": {"name": r["name"], "unit": r["unit"]}}


def _def_attrs_op(conn, user_id: int, def_id: int) -> dict:
    old = [[r["attr_key"], r["value_text"]] for r in conn.execute(
        "SELECT attr_key, value_text FROM attrs WHERE entity_type = 'def' AND entity_id = ? "
        "AND value_text IS NOT NULL AND owner_id = ?", (def_id, user_id),
    ).fetchall()]
    return {"op": "set_attrs", "entity_type": "def", "entity_id": def_id, "old": old}


def _def_aliases_op(conn, user_id: int, def_id: int) -> dict:
    old = [r["name"] for r in conn.execute(
        "SELECT name FROM item_aliases WHERE def_id = ? AND owner_id = ?", (def_id, user_id)
    ).fetchall()]
    return {"op": "set_aliases", "def_id": def_id, "old": old}


def _image_op(conn, user_id: int, entity_type: str, entity_id: int) -> dict:
    row = conn.execute(
        "SELECT file_path, mime FROM images WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
        (user_id, entity_type, entity_id),
    ).fetchone()
    if not row:
        return {"op": "clear_image", "entity_type": entity_type, "entity_id": entity_id}
    return {"op": "set_image", "entity_type": entity_type, "entity_id": entity_id,
            "file_path": row["file_path"], "mime": row["mime"],
            "bytes_b64": _b64_of(user_id, row["file_path"])}


def _created_path(conn, user_id: int, path, ctx: dict, type_tag=None, group=None) -> int:
    """mkdir -p a path; every newly created space is recorded as a reverse op.
    Leaf gets `type_tag` (falling back to a name guess for top-level scenes) and
    `group` (家/公司, stored on layout_json for the scene-card corner)."""
    parent: Optional[int] = None
    leaf: Optional[int] = None
    segs = _segs(path)
    for i, name in enumerate(segs):
        n = norm_text(name)
        if not n:
            raise ValueError("路径包含空段")
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
            if i == len(segs) - 1 and type_tag:
                tt = type_tag
            elif parent is None:
                tt = _guess_type(name)
            else:
                tt = "generic"
            cur = conn.execute(
                "INSERT INTO spaces (parent_id, name, name_norm, ord, type_tag, owner_id) "
                "VALUES (?, ?, ?, 0, ?, ?)",
                (parent, name, n, tt, user_id),
            )
            node_id = int(cur.lastrowid)
            ctx["undo"].append({"ops": [{"op": "remove_space", "space_id": node_id}]})
        parent = node_id
        leaf = node_id
    if group and leaf is not None:
        cur = conn.execute(
            "SELECT layout_json FROM spaces WHERE id = ? AND owner_id = ?", (leaf, user_id)
        ).fetchone()
        lay = json.loads(cur["layout_json"] or "{}") if cur and cur["layout_json"] else {}
        lay["group"] = group
        conn.execute(
            "UPDATE spaces SET layout_json = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
            (json.dumps(lay, ensure_ascii=False), leaf, user_id),
        )
    return int(leaf)


def _register_with_undo(conn, u: int, name: str, space_id: int, qty: int, ctx: dict, **kw) -> dict:
    pre_def = conn.execute(
        "SELECT id FROM item_defs WHERE owner_id = ? AND name_norm = ?", (u, norm_text(name))
    ).fetchone()
    row = conn.execute(
        "SELECT l.id FROM item_lots l JOIN item_defs d ON d.id = l.def_id "
        "WHERE l.owner_id = ? AND d.owner_id = ? AND d.name_norm = ? "
        "AND l.space_id = ? AND l.status = 'present'",
        (u, u, norm_text(name), space_id),
    ).fetchone()
    if row is not None:
        op = _lot_patch_op(conn, u, row["id"])
        if op:
            ctx["undo"].append({"ops": [op]})
    out = items_service.register(conn, u, name=name, space_id=space_id, qty=qty, **kw)
    if not out["merged"]:
        op: dict = {"op": "remove_lot", "lot_id": out["lot"]["lot_id"]}
        if pre_def is None:
            op["def_id"] = out["lot"]["def_id"]  # also drop the def we just created
        ctx["undo"].append({"ops": [op]})
    return out


def _category_id(conn, user_id: int, name: str) -> int:
    n = norm_text(name)
    row = conn.execute(
        "SELECT id FROM categories WHERE owner_id = ? AND name_norm = ?", (user_id, n)
    ).fetchone()
    if row:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO categories (name, name_norm, owner_id) VALUES (?, ?, ?)", (name, n, user_id)
    )
    return int(cur.lastrowid)


# ------------------------------------------------------------------ undo apply ----
def _restore_snapshot(conn, user_id: int, data: dict, counts: dict) -> None:
    for s in data.get("spaces", []):
        cols = list(s.keys())
        conn.execute(
            f"INSERT OR IGNORE INTO spaces ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})",
            [s[c] for c in cols],
        )
        counts["spaces"] += 1
    for lot in data.get("lots", []):
        cols = list(lot.keys())
        conn.execute(
            f"INSERT OR IGNORE INTO item_lots ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})",
            [lot[c] for c in cols],
        )
        counts["lots"] += 1
    for a in data.get("attrs", []):
        cols = list(a.keys())
        conn.execute(
            f"INSERT OR IGNORE INTO attrs ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})",
            [a[c] for c in cols],
        )
        counts["attrs"] += 1
    for im in data.get("images", []):
        if im.get("bytes_b64"):
            p = MEDIA_DIR / str(user_id) / im["file_path"]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(base64.b64decode(im["bytes_b64"]))
        conn.execute(
            "INSERT OR IGNORE INTO images (owner_id, entity_type, entity_id, file_path, mime) VALUES (?,?,?,?,?)",
            (user_id, im["entity_type"], im["entity_id"], im["file_path"], im.get("mime")),
        )
        counts["images"] += 1


def _apply_op(conn, user_id: int, op: dict, counts: dict) -> None:
    kind = op["op"]
    if kind == "patch_lot":
        old = op["old"]
        conn.execute(
            "UPDATE item_lots SET qty = ?, status = ?, space_id = ?, notes = ?, updated_at = datetime('now') "
            "WHERE id = ? AND owner_id = ?",
            (old["qty"], old["status"], old["space_id"], old["notes"], op["lot_id"], user_id),
        )
        counts["lots"] += 1
    elif kind == "patch_space":
        old = op["old"]
        conn.execute(
            "UPDATE spaces SET name = ?, name_norm = ?, type_tag = ?, parent_id = ?, layout_json = ?, updated_at = datetime('now') "
            "WHERE id = ? AND owner_id = ?",
            (old["name"], norm_text(old["name"]), old["type_tag"], old["parent_id"], old["layout_json"], op["space_id"], user_id),
        )
        counts["spaces"] += 1
    elif kind == "patch_def":
        old = op["old"]
        conn.execute(
            "UPDATE item_defs SET name = ?, name_norm = ?, unit = ?, updated_at = datetime('now') "
            "WHERE id = ? AND owner_id = ?",
            (old["name"], norm_text(old["name"]), old["unit"], op["def_id"], user_id),
        )
    elif kind == "remove_lot":
        items_service.remove(conn, user_id, lot_id=op["lot_id"])
        if op.get("def_id"):
            left = conn.execute(
                "SELECT count(*) n FROM item_lots WHERE def_id = ? AND owner_id = ?",
                (op["def_id"], user_id),
            ).fetchone()["n"]
            if left == 0:
                conn.execute("DELETE FROM item_aliases WHERE def_id = ? AND owner_id = ?", (op["def_id"], user_id))
                conn.execute("DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND owner_id = ?", (op["def_id"], user_id))
                conn.execute("DELETE FROM item_defs WHERE id = ? AND owner_id = ?", (op["def_id"], user_id))
        counts["lots"] += 1
    elif kind == "remove_space":
        spaces_service.delete(conn, user_id, op["space_id"])
        counts["spaces"] += 1
    elif kind == "clear_image":
        media_service.delete(conn, user_id, op["entity_type"], op["entity_id"])
        counts["images"] += 1
    elif kind == "set_image":
        if op.get("bytes_b64"):
            p = MEDIA_DIR / str(user_id) / op["file_path"]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(base64.b64decode(op["bytes_b64"]))
        conn.execute(
            "INSERT OR REPLACE INTO images (owner_id, entity_type, entity_id, file_path, mime) VALUES (?,?,?,?,?)",
            (user_id, op["entity_type"], op["entity_id"], op["file_path"], op.get("mime")),
        )
        counts["images"] += 1
    elif kind == "remove_category":
        conn.execute("DELETE FROM categories WHERE id = ? AND owner_id = ?", (op["category_id"], user_id))
        counts["categories"] += 1
    elif kind == "patch_category":
        conn.execute(
            "UPDATE categories SET name = ?, name_norm = ? WHERE id = ? AND owner_id = ?",
            (op["old_name"], norm_text(op["old_name"]), op["category_id"], user_id),
        )
        counts["categories"] += 1
    elif kind == "unmerge_category":
        c = op["category"]
        cols = list(c.keys())
        conn.execute(
            f"INSERT OR IGNORE INTO categories ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})",
            [c[k] for k in cols],
        )
        if op.get("def_ids"):
            ph = ",".join("?" * len(op["def_ids"]))
            conn.execute(
                f"UPDATE item_defs SET category_id = ? WHERE id IN ({ph}) AND owner_id = ?",
                [c["id"]] + op["def_ids"] + [user_id],
            )
        counts["categories"] += 1
    elif kind == "unmerge_def":
        d = op["def"]
        cols = list(d.keys())
        conn.execute(
            f"INSERT OR IGNORE INTO item_defs ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})",
            [d[c] for c in cols],
        )
        if op.get("lot_ids"):
            ph = ",".join("?" * len(op["lot_ids"]))
            conn.execute(
                f"UPDATE item_lots SET def_id = ? WHERE id IN ({ph}) AND owner_id = ?",
                [d["id"]] + op["lot_ids"] + [user_id],
            )
        for n in op.get("alias_names", []):
            conn.execute("DELETE FROM item_aliases WHERE def_id = ? AND name = ? AND owner_id = ?", (d["id"], n, user_id))
        for k in op.get("attr_keys", []):
            conn.execute("DELETE FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND attr_key = ? AND owner_id = ?", (d["id"], k, user_id))
        counts["defs"] += 1
    elif kind == "restore_order":
        for idx, sid in enumerate(op["ordered_ids"]):
            conn.execute("UPDATE spaces SET ord = ? WHERE id = ? AND owner_id = ?", (idx, sid, user_id))
        counts["spaces"] += 1
    elif kind == "set_attrs":
        conn.execute(
            "DELETE FROM attrs WHERE entity_type = ? AND entity_id = ? AND owner_id = ?",
            (op["entity_type"], op["entity_id"], user_id),
        )
        for k, v in op["old"]:
            conn.execute(
                "INSERT INTO attrs (entity_type, entity_id, attr_key, value_type, value_text, owner_id) "
                "VALUES (?, ?, ?, 'text', ?, ?)",
                (op["entity_type"], op["entity_id"], k, v, user_id),
            )
        counts["attrs"] += 1
    elif kind == "set_aliases":
        conn.execute("DELETE FROM item_aliases WHERE def_id = ? AND owner_id = ?", (op["def_id"], user_id))
        for n in op["old"]:
            conn.execute(
                "INSERT INTO item_aliases (def_id, name, name_norm, owner_id) VALUES (?, ?, ?, ?)",
                (op["def_id"], n, norm_text(n), user_id),
            )


def restore_undo(conn, user_id: int, bundles: list[dict]) -> dict:
    """Undo one run: snapshot bundles re-insert deleted rows, op bundles reverse
    mutations. Replayed LIFO — undo the newest change first and tear down created
    rows last, so a cascade can never eat a row an earlier op still needs."""
    counts = {"spaces": 0, "lots": 0, "attrs": 0, "images": 0, "categories": 0, "defs": 0}
    for data in reversed(bundles):
        if data.get("ops"):
            for op in reversed(data["ops"]):
                try:
                    _apply_op(conn, user_id, op, counts)
                except Exception:  # noqa: BLE001 — already undone / gone
                    pass
        else:
            _restore_snapshot(conn, user_id, data, counts)
    return counts


def _persist_undo(user_id: int, ctx: dict) -> int | None:
    if not ctx.get("undo"):
        return None
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO agent_undo (user_id, data_json) VALUES (?, ?)",
            (user_id, json.dumps(ctx["undo"], ensure_ascii=False)),
        )
        return int(cur.lastrowid)


# ------------------------------------------------------------------ executors ----
def _exec_create(conn, u: int, a: CreateArgs, ctx: dict) -> list[dict]:
    lines: list[dict] = []
    for sp in a.spaces or []:
        if isinstance(sp, list):
            path, tt, grp = sp, None, None
        elif isinstance(sp, dict):
            path = sp.get("path") or []
            tt = sp.get("type_tag")
            grp = sp.get("group")
        else:
            continue
        try:
            _created_path(conn, u, path, ctx, type_tag=tt, group=grp)
            extra = " · ".join(x for x in (tt, f"归属:{grp}" if grp else None) if x)
            lines.append({"ok": True, "text": f"已建空间 {_p(path)}{(' · ' + extra) if extra else ''}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"建空间 {_p(path)}：{e}"})
    for it in a.items or []:
        try:
            sid = _created_path(conn, u, it.at, ctx)
            _register_with_undo(conn, u, it.name.strip(), sid, max(1, it.qty), ctx,
                                unit=it.unit, notes=it.notes, status=_coerce_status(it.status),
                                category=it.category, alias=it.alias,
                                attrs=[list(x) for x in (it.attrs or [])])
            lines.append({"ok": True, "text": f"已登记 {it.name} ×{it.qty} @ {_p(it.at)}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"登记 {it.name}：{e}"})
    return lines


def _exec_update(conn, u: int, a: UpdateArgs, ctx: dict) -> list[dict]:
    lines: list[dict] = []
    for mv in a.moves or []:
        try:
            sid = _resolve_space(conn, u, mv.from_path)
            if sid is None:
                raise ValueError("不能移动根目录")
            tid = _resolve_space(conn, u, mv.to_path)
            if tid is None:
                raise ValueError(f"目标 {_p(mv.to_path)} 不存在（先 create）")
            if tid in spaces_service.ancestor_ids(conn, u, sid):
                raise ValueError("不能移到自己的子路径里")
            op = _space_patch_op(conn, u, sid)
            if op:
                ctx["undo"].append({"ops": [op]})
            spaces_service.move(conn, u, sid, parent_id=tid, index=None)
            lines.append({"ok": True, "text": f"已移 {_p(mv.from_path)} → {_p(mv.to_path)}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"移 {_p(mv.from_path)}：{e}"})
    for mv in a.item_moves or []:
        try:
            it = _resolve_item(conn, u, mv.name, mv.under)
            tid = _resolve_space(conn, u, mv.to_path)
            if tid is None:
                raise ValueError(f"目标 {_p(mv.to_path)} 不存在（先 create）")
            op = _lot_patch_op(conn, u, it["lot_id"])
            if op:
                ctx["undo"].append({"ops": [op]})
            items_service.patch(conn, u, it["lot_id"], space_id=tid)
            lines.append({"ok": True, "text": f"已移 {mv.name} → {_p(mv.to_path)}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"移 {mv.name}：{e}"})
    for sp in a.spaces or []:
        try:
            sid = _resolve_space(conn, u, sp.path)
            if sid is None:
                raise ValueError("根目录不可改")
            op = _space_patch_op(conn, u, sid)
            if op:
                ctx["undo"].append({"ops": [op]})
            spaces_service.update(conn, u, sid, name=sp.name, type_tag=sp.type_tag)
            if sp.group:
                cur = conn.execute(
                    "SELECT layout_json FROM spaces WHERE id = ? AND owner_id = ?", (sid, u)
                ).fetchone()
                lay = json.loads(cur["layout_json"] or "{}") if cur and cur["layout_json"] else {}
                lay["group"] = sp.group
                spaces_service.update(conn, u, sid, layout_json=json.dumps(lay, ensure_ascii=False))
            parts = [x for x in (sp.name, sp.type_tag, f"归属:{sp.group}" if sp.group else None) if x]
            lines.append({"ok": True, "text": f"已改 {_p(sp.path)} → {'/'.join(parts)}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"改 {_p(sp.path)}：{e}"})
    for it in a.items or []:
        try:
            lot = _resolve_item(conn, u, it.name, it.under)
            ops: list[dict] = []
            if it.new_name or it.unit is not None:
                dop = _def_patch_op(conn, u, lot["def_id"])
                if dop:
                    ops.append(dop)
                if it.new_name:
                    items_service.rename_def(conn, u, def_id=lot["def_id"], name=it.new_name)
                if it.unit is not None:
                    conn.execute(
                        "UPDATE item_defs SET unit = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
                        (it.unit, lot["def_id"], u),
                    )
            pop = _lot_patch_op(conn, u, lot["lot_id"])
            if pop:
                ops.append(pop)
            if it.alias:
                ops.append(_def_aliases_op(conn, u, lot["def_id"]))
                conn.execute("DELETE FROM item_aliases WHERE def_id = ? AND owner_id = ?", (lot["def_id"], u))
                for part in _ALIAS_SPLIT.split(it.alias):
                    pn = part.strip()
                    nn = norm_text(pn)
                    if nn:
                        conn.execute(
                            "INSERT INTO item_aliases (def_id, name, name_norm, owner_id) VALUES (?, ?, ?, ?)",
                            (lot["def_id"], pn, nn, u),
                        )
            if it.attrs_set or it.attrs_del:
                ops.append(_def_attrs_op(conn, u, lot["def_id"]))
                for k, v in it.attrs_set or []:
                    if k.strip() and v:
                        items_service.set_attr(conn, u, def_id=lot["def_id"], key=k, value=v)
                for k in it.attrs_del or []:
                    items_service.del_attr(conn, u, def_id=lot["def_id"], key=k)
            if ops:
                ctx["undo"].append({"ops": ops})
            status = _coerce_status(it.status) if it.status is not None else None
            fields = {k: v for k, v in {
                "qty": it.qty, "status": status, "notes": it.notes}.items() if v is not None}
            if fields:
                items_service.patch(conn, u, lot["lot_id"], **fields)
            if it.category:
                conn.execute(
                    "UPDATE item_defs SET category_id = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
                    (_category_id(conn, u, it.category), lot["def_id"], u),
                )
            changed = [k for k, v in {
                "名": it.new_name, "量": it.qty, "状态": it.status, "注": it.notes,
                "类": it.category, "单位": it.unit, "别名": it.alias}.items() if v is not None]
            if it.attrs_set:
                changed.append(f"属性+{len(it.attrs_set)}")
            if it.attrs_del:
                changed.append(f"属性-{len(it.attrs_del)}")
            lines.append({"ok": True, "text": f"已改 {it.name}（{'/'.join(map(str, changed))}）"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"改 {it.name}：{e}"})
    for path in a.to_items or []:
        try:
            sid = _resolve_space(conn, u, path)
            if sid is None:
                raise ValueError("根目录不能转为物品")
            _capture_space(conn, u, sid, ctx)
            out = spaces_service.to_item(conn, u, sid)
            ctx["undo"].append({"ops": [{"op": "remove_lot", "lot_id": out["lot"]["lot_id"]}]})
            lines.append({"ok": True, "text": f"已把 {_p(path)} 转为物品"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"转 {_p(path)}：{e}"})
    return lines


def _exec_remove(conn, u: int, a: RemoveArgs, ctx: dict) -> list[dict]:
    lines: list[dict] = []
    for path in a.spaces or []:
        try:
            sid = _resolve_space(conn, u, path)
            if sid is None:
                raise ValueError("不能删除根目录")
            _capture_space(conn, u, sid, ctx)
            spaces_service.delete(conn, u, sid)
            lines.append({"ok": True, "text": f"已删 {_p(path)}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"删 {_p(path)}：{e}"})
    for ref in a.items or []:
        try:
            it = _resolve_item(conn, u, ref.name, ref.under)
            _capture_lot(conn, u, it["lot_id"], ctx)
            items_service.remove(conn, u, lot_id=it["lot_id"])
            lines.append({"ok": True, "text": f"已删 {ref.name}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"删 {ref.name}：{e}"})
    return lines


def _exec_category(conn, u: int, a: CategoryOp, ctx: dict) -> list[dict]:
    lines: list[dict] = []
    for name in a.add or []:
        n = name.strip()
        if not n:
            continue
        try:
            row = conn.execute(
                "SELECT id FROM categories WHERE owner_id = ? AND name_norm = ?", (u, norm_text(n))
            ).fetchone()
            if row is None:
                cur = conn.execute(
                    "INSERT INTO categories (parent_id, name, name_norm, ord, owner_id) VALUES (NULL, ?, ?, 0, ?)",
                    (n, norm_text(n), u),
                )
                ctx["undo"].append({"ops": [{"op": "remove_category", "category_id": int(cur.lastrowid)}]})
                lines.append({"ok": True, "text": f"已新增分类 {n}"})
            else:
                lines.append({"ok": True, "text": f"分类已存在 {n}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"新增分类 {n}：{e}"})
    for r in a.rename or []:
        try:
            c = _resolve_category(conn, u, r.name)
            ctx["undo"].append({"ops": [{"op": "patch_category", "category_id": c["id"], "old_name": c["name"]}]})
            cat_service.rename(conn, u, category_id=c["id"], name=r.to)
            lines.append({"ok": True, "text": f"分类改名 {r.name} → {r.to}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"分类改名 {r.name}：{e}"})
    for m in a.merge or []:
        try:
            src = _resolve_category(conn, u, m.source)
            dst = _resolve_category(conn, u, m.into)
            def_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM item_defs WHERE category_id = ? AND owner_id = ?", (src["id"], u)
            ).fetchall()]
            ctx["undo"].append({"ops": [{"op": "unmerge_category", "category": src, "def_ids": def_ids}]})
            cat_service.remove(conn, u, category_id=src["id"], into_id=dst["id"])
            lines.append({"ok": True, "text": f"分类 {m.source} 并入 {m.into}（{len(def_ids)} 件）"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"合并分类 {m.source}：{e}"})
    for name in a.remove or []:
        try:
            c = _resolve_category(conn, u, name)
            cnt = conn.execute(
                "SELECT count(*) n FROM item_defs WHERE category_id = ? AND owner_id = ?", (c["id"], u)
            ).fetchone()["n"]
            if cnt:
                raise ValueError(f"「{name}」还有 {cnt} 件物品，先合并再删")
            ctx["undo"].append({"ops": [{"op": "unmerge_category", "category": c, "def_ids": []}]})
            conn.execute("DELETE FROM categories WHERE id = ? AND owner_id = ?", (c["id"], u))
            lines.append({"ok": True, "text": f"已删除分类 {name}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"删除分类 {name}：{e}"})
    return lines


def _exec_merge_defs(conn, u: int, a: MergeDefsArgs, ctx: dict) -> list[dict]:
    lines: list[dict] = []
    try:
        target = _resolve_def(conn, u, a.target)
    except Exception as e:  # noqa: BLE001
        return [{"ok": False, "text": str(e)}]
    for s in a.sources or []:
        try:
            src = _resolve_def(conn, u, s)
            if src["id"] == target["id"]:
                lines.append({"ok": False, "text": f"「{s}」就是目标本身，跳过"})
                continue
            lot_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM item_lots WHERE def_id = ? AND owner_id = ?", (src["id"], u)
            ).fetchall()]
            moved_aliases: list[str] = []
            for al in conn.execute(
                "SELECT name, name_norm FROM item_aliases WHERE def_id = ? AND owner_id = ?", (src["id"], u)
            ).fetchall():
                if conn.execute(
                    "SELECT 1 FROM item_aliases WHERE def_id = ? AND name_norm = ? AND owner_id = ?",
                    (target["id"], al["name_norm"], u),
                ).fetchone() is None:
                    conn.execute(
                        "INSERT INTO item_aliases (def_id, name, name_norm, owner_id) VALUES (?, ?, ?, ?)",
                        (target["id"], al["name"], al["name_norm"], u),
                    )
                    moved_aliases.append(al["name"])
            moved_attr_keys: list[str] = []
            for ar in conn.execute(
                "SELECT attr_key, value_type, value_text, value_int, value_real, value_bool, uom "
                "FROM attrs WHERE entity_type = 'def' AND entity_id = ? AND owner_id = ?", (src["id"], u)
            ).fetchall():
                cur = conn.execute(
                    "INSERT OR IGNORE INTO attrs "
                    "(entity_type, entity_id, attr_key, value_type, value_text, value_int, value_real, value_bool, uom, owner_id) "
                    "VALUES ('def', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (target["id"], ar["attr_key"], ar["value_type"], ar["value_text"],
                     ar["value_int"], ar["value_real"], ar["value_bool"], ar["uom"], u),
                )
                if cur.rowcount:
                    moved_attr_keys.append(ar["attr_key"])
            conn.execute(
                "UPDATE item_lots SET def_id = ? WHERE def_id = ? AND owner_id = ?",
                (target["id"], src["id"], u),
            )
            conn.execute("DELETE FROM item_defs WHERE id = ? AND owner_id = ?", (src["id"], u))
            ctx["undo"].append({"ops": [{
                "op": "unmerge_def", "def": src, "lot_ids": lot_ids,
                "alias_names": moved_aliases, "attr_keys": moved_attr_keys,
            }]})
            lines.append({"ok": True, "text": f"已合并 {s} → {a.target}（{len(lot_ids)} 条）"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"合并 {s}：{e}"})
    return lines


def _exec_set_image(conn, u: int, a: SetImageArgs, ctx: dict) -> list[dict]:
    if not ctx.get("attachments"):
        return [{"ok": False, "text": "没有可用的上传图片附件"}]
    data = ctx["attachments"][0]
    targets: list[tuple[str, int, str]] = []
    for ref in a.items or []:
        try:
            it = _resolve_item(conn, u, ref.name, ref.under)
            targets.append(("lot", it["lot_id"], ref.name))
        except Exception as e:  # noqa: BLE001
            return [{"ok": False, "text": str(e)}]
    for p in a.spaces or []:
        try:
            sid = _resolve_space(conn, u, p)
            if sid is None:
                raise ValueError("根目录不能设图")
            targets.append(("space", sid, _p(p)))
        except Exception as e:  # noqa: BLE001
            return [{"ok": False, "text": str(e)}]
    if not targets:
        return [{"ok": False, "text": "没有指定要设图的物品或空间"}]
    et, eid, label = targets[0]
    ctx["undo"].append({"ops": [_image_op(conn, u, et, eid)]})
    media_service.put(conn, u, et, eid, "agent.png", data, "image/jpeg")
    return [{"ok": True, "text": f"已把上传图片设为 {label} 的预览图"}]


def _exec_reorder(conn, u: int, a: ReorderArgs, ctx: dict) -> list[dict]:
    pid = _resolve_space(conn, u, a.path)  # None = root
    if pid is None:
        children = [r["id"] for r in conn.execute(
            "SELECT id FROM spaces WHERE parent_id IS NULL AND owner_id = ? ORDER BY ord, id", (u,)
        ).fetchall()]
    else:
        children = [r["id"] for r in conn.execute(
            "SELECT id FROM spaces WHERE parent_id = ? AND owner_id = ? ORDER BY ord, id", (pid, u)
        ).fetchall()]
    if not children:
        return [{"ok": False, "text": f"{_p(a.path)} 下没有可排序的子空间"}]
    ctx["undo"].append({"ops": [{"op": "restore_order", "parent_id": pid, "ordered_ids": children}]})
    by_name = {}
    for sid in children:
        r = conn.execute("SELECT name_norm FROM spaces WHERE id = ?", (sid,)).fetchone()
        by_name[r["name_norm"]] = sid
    ordered: list[int] = []
    missing: list[str] = []
    for nm in a.spaces:
        sid = by_name.get(norm_text(nm))
        if sid is None:
            missing.append(nm)
        else:
            ordered.append(sid)
    for sid in children:
        if sid not in ordered:
            ordered.append(sid)
    for idx, sid in enumerate(ordered):
        conn.execute("UPDATE spaces SET ord = ? WHERE id = ? AND owner_id = ?", (idx, sid, u))
    msg = f"已调整 {len(ordered) - len(missing)} 个子空间的顺序"
    if missing:
        msg += f"；未找到：{'、'.join(missing)}"
    return [{"ok": True, "text": msg}]


def apply_plan(user_id: int, plan: list[dict], attachments=None) -> tuple[list, int | None]:
    """Execute a validated plan sequentially in one transaction (no step cap)."""
    runners = {
        "create": _exec_create, "update": _exec_update, "remove": _exec_remove,
        "category": _exec_category, "merge_defs": _exec_merge_defs,
        "set_image": _exec_set_image, "reorder": _exec_reorder,
    }
    ctx: dict = {
        "undo": [],
        "attachments": [base64.b64decode(a["image_base64"]) for a in (attachments or []) if a.get("image_base64")],
    }
    results: list[dict] = []
    with tx() as conn:
        for i, step in enumerate(plan):
            try:
                model = _EXEC_ARGS[step["tool"]].model_validate(step.get("args") or {})
                lines = runners[step["tool"]](conn, user_id, model, ctx)
            except Exception as e:  # noqa: BLE001
                lines = [{"ok": False, "text": str(e)}]
            results.append({"index": i, "tool": step["tool"], "lines": lines})
    undo_id = _persist_undo(user_id, ctx)
    return results, undo_id


# ------------------------------------------------------------------ plan loop ----
def _system_with_categories(user_id: int) -> str:
    with read() as conn:
        cats = _category_names_full(conn, user_id)
    return SYSTEM + f"\n\n现有分类（尽量复用这些名称，不要轻易新建）：{cats}"


READ_TREE = ("read_tree", "读取目录树(可选某路径之下),含每个空间里的物品。规划前用它了解结构,不要猜路径。", {
    "type": "object",
    "properties": {"path": {"type": "array", "items": {"type": "string"},
                            "description": "可选,如 ['宿舍','书桌'];不传=整棵树"}},
    "required": [],
})
FIND_ITEM = ("find_item", "按名称查找物品(可模糊,可选限定路径 under),返回名称/数量/状态/完整路径。", {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "物品名称关键词"},
        "under": {"type": "array", "items": {"type": "string"}, "description": "可选,限定在某路径下"},
    },
    "required": ["name"],
})
LIST_CATEGORIES = ("list_categories", "列出所有分类及其物品数量。", {"type": "object", "properties": {}, "required": []})
SUBMIT_PLAN = ("submit_plan", "提交执行方案(等待用户确认后才会执行)。steps 每项 {tool, args}:"
    "tool=create args={spaces:[路径 或 {path,type_tag?,group?}]...}, items:[{name, at:[路径], qty?, unit?, category?, notes?, status?, alias?, attrs:[[键,值]]}]};"
    "tool=update args={moves:[{from_path:[...],to_path:[...]}], item_moves:[{name,under?,to_path:[...]}], "
    "spaces:[{path:[...],name?,type_tag?,group?}], items:[{name,under?,new_name?,qty?,status?,notes?,category?,unit?,alias?,attrs_set:[[键,值]],attrs_del:[键]}], "
    "to_items:[[路径]]};"
    "tool=remove args={spaces:[[路径]...], items:[{name,under?}]};"
    "tool=category args={add:[名称], rename:[{name,to}], merge:[{source,into}], remove:[名称]};"
    "tool=merge_defs args={target:名称, sources:[名称]};"
    "tool=set_image args={items:[{name,under?}], spaces:[[路径]]}(把本次上传的图片设为该实体预览图,只作用第一个引用);"
    "tool=reorder args={path:[...], spaces:[按新顺序排的名称]}. "
    "物品 status 只能取 present/lent/consumed（在库/借出/用完）;type_tag 取 room/wardrobe/desk/drawer/shelf/box/generic;"
    "group 如 家/公司 标在顶层场景卡片角。"
    "同类操作放进同一个数组分批批量;只有存在先后依赖才拆步骤。", {
    "type": "object",
    "properties": {"steps": {"type": "array", "items": {
        "type": "object",
        "properties": {"tool": {"type": "string", "enum": ["create", "update", "remove", "category", "merge_defs", "set_image", "reorder"]},
                       "args": {"type": "object"}},
        "required": ["tool", "args"]}}},
    "required": ["steps"],
})

_PLAN_TOOLS = [READ_TREE, FIND_ITEM, LIST_CATEGORIES, SUBMIT_PLAN]


def _user_content(message, attachments, anthropic_mode):
    parts = []
    if message and message.strip():
        parts.append({"type": "text", "text": message.strip()})
    for img in attachments or []:
        b64 = img.get("image_base64", "")
        if not b64:
            continue
        if anthropic_mode:
            parts.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})
        else:
            parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    return parts or [{"type": "text", "text": "(无输入)"}]


_TOOL_CN = {"create": "新建", "update": "修改", "remove": "删除", "category": "分类",
            "merge_defs": "合并", "set_image": "设图", "reorder": "排序"}


def _plan_summary(steps) -> str:
    c: dict[str, int] = {}
    for s in steps or []:
        t = s.get("tool") if isinstance(s, dict) else None
        c[t] = c.get(t, 0) + 1
    if not c:
        return "没有可执行的操作。"
    return "已拟好执行方案：" + "、".join(f"{_TOOL_CN.get(t, t)}×{n}" for t, n in c.items() if t)


def _read_brief(name: str, args: dict) -> str:
    if name == "read_tree":
        return _p(args.get("path")) if args.get("path") else "整棵树"
    if name == "find_item":
        return str(args.get("name"))
    return ""


def _plan_read(user_id: int, name: str, args: dict) -> str:
    try:
        with read() as conn:
            if name == "read_tree":
                return _read_tree_text(conn, user_id, args.get("path"))
            if name == "find_item":
                return _find_text(conn, user_id, args.get("name"), args.get("under"))
            if name == "list_categories":
                return _category_names_full(conn, user_id)
            return f"未知工具 {name}"
    except ValueError as e:
        return str(e)


def plan_agent(base_url, api_key, model, user_id, message, attachments,
               revision=None, prev_steps=None) -> tuple[list, str, list[str]]:
    """Returns (plan_steps_raw, reply, reads_log). Only reads happen here — nothing mutates.
    `revision` re-drafts the existing `prev_steps` plan after a user tweak."""
    if "anthropic.com" in base_url:
        return _plan_anthropic(base_url, api_key, model, user_id, message, attachments, revision, prev_steps)
    return _plan_openai(base_url, api_key, model, user_id, message, attachments, revision, prev_steps)


def _plan_openai(base_url, api_key, model, user_id, message, attachments,
                 revision=None, prev_steps=None) -> tuple[list, str, list[str]]:
    client = OpenAI(base_url=base_url, api_key=api_key or "sk-local")
    tools = [{"type": "function", "function": {"name": n, "description": d, "parameters": p}}
             for n, d, p in _PLAN_TOOLS]
    messages = [
        {"role": "system", "content": _system_with_categories(user_id)},
        {"role": "user", "content": _user_content(message, attachments, False)},
    ]
    if revision:
        prev = json.dumps(prev_steps or [], ensure_ascii=False)
        messages.append({"role": "user", "content":
            f"当前已拟的方案（steps JSON）：\n{prev}\n\n用户想修改：{revision}\n"
            "请基于原需求重新出方案：只调整用户要求的部分，尽量少改动其它内容，仍用 submit_plan 提交。"})
    reads: list[str] = []
    for _ in range(30):  # runaway guard for the read loop; planning ends at submit_plan
        resp = client.chat.completions.create(model=model, messages=messages, tools=tools,
                                              tool_choice="auto", max_tokens=2000, temperature=0.2)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return [], msg.content or "(没有给出执行方案)", reads
        messages.append({
            "role": "assistant", "content": msg.content or "",
            "tool_calls": [{"id": tc.id, "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                           for tc in msg.tool_calls],
        })
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            if tc.function.name == "submit_plan":
                steps = args.get("steps") or []
                return steps, (msg.content or "").strip() or _plan_summary(steps), reads
            brief = _read_brief(tc.function.name, args)
            if brief:
                reads.append(f"{tc.function.name} {brief}")
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": _plan_read(user_id, tc.function.name, args)})
    return [], "(没能形成执行方案，请换个说法或更具体一点)", reads


def _plan_anthropic(base_url, api_key, model, user_id, message, attachments,
                    revision=None, prev_steps=None) -> tuple[list, str, list[str]]:
    client = anthropic.Anthropic(api_key=api_key or "sk-local")
    tools = [{"name": n, "description": d, "input_schema": p} for n, d, p in _PLAN_TOOLS]
    messages = [{"role": "user", "content": _user_content(message, attachments, True)}]
    if revision:
        prev = json.dumps(prev_steps or [], ensure_ascii=False)
        messages.append({"role": "user", "content":
            f"当前已拟的方案（steps JSON）：\n{prev}\n\n用户想修改：{revision}\n"
            "请基于原需求重新出方案：只调整用户要求的部分，尽量少改动其它内容，仍用 submit_plan 提交。"})
    reads: list[str] = []
    for _ in range(30):
        resp = client.messages.create(model=model, system=_system_with_categories(user_id), messages=messages,
                                      tools=tools, max_tokens=2000, temperature=0.2)
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            return [], "".join(b.text for b in resp.content if b.type == "text") or "(没有给出执行方案)", reads
        messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        results = []
        for b in tool_uses:
            if b.name == "submit_plan":
                plan = (b.input or {}).get("steps") or []
                text = "".join(x.text for x in resp.content if x.type == "text")
                if plan:
                    return plan, text.strip() or _plan_summary(plan), reads
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": "方案为空,请再给一次"})
                continue
            brief = _read_brief(b.name, b.input or {})
            if brief:
                reads.append(f"{b.name} {brief}")
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": _plan_read(user_id, b.name, b.input or {})})
        messages.append({"role": "user", "content": results})
    return [], "(没能形成执行方案，请换个说法或更具体一点)", reads
