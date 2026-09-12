from __future__ import annotations

import base64
import json
from typing import Optional, Union

import anthropic
import openai
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from app.core.errors import BadRequest
from app.core.normalize import norm_text
from app.db.engine import read, tx
from app.domains.items import service as items_service
from app.domains.media import service as media_service
from app.domains.spaces import service as spaces_service

SYSTEM = """You are whereisit's catalog assistant. The user asks you to organize their
item catalog. You NEVER touch data directly: you may call read_tree to look at
the structure, then submit_plan to propose an execution plan. The user reviews
and approves the plan before it runs — so plan precisely.

Rules:
- Never guess paths. Call read_tree first (full tree, or under a specific path)
  until you know exactly what exists. Reference everything by full path from
  the root, e.g. ["宿舍","书桌","抽屉"].
- Only three kinds of actions exist:
  create — new subspaces and/or new items;
  update — move a subtree or an item, rename/retype a space, patch item info
           (name/qty/status/notes/category/unit), convert a space into an item;
  remove — delete spaces (with everything inside) and/or items.
- Order steps by dependency: create before moves into created paths; moves
  before removing emptied containers; removals last. Everything inside ONE
  step's arrays happens as one batch (order within an array doesn't matter),
  steps run strictly 1→N.
- Batch aggressively: many same-kind changes belong in one step's array, not
  many steps. Keep the total number of steps as small as the ordering allows.
- read_tree never appears in the plan.
- Lending with a return date (e.g. 3天后还) = update the item: status 'lent'
  and notes mentioning the due date.
- Deletion is allowed only for restructuring (empty/duplicate containers), not
  plain data removal the user didn't ask for.
- When you call submit_plan, also write a short plan summary (in the user's
  language) as your reply text. Never ask the user questions mid-planning; do
  the reasonable thing."""

# ------------------------------------------------------------------ plan model ----
class ItemCreate(BaseModel):
    name: str
    at: list[str]
    qty: int = 1
    unit: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

class CreateArgs(BaseModel):
    spaces: Optional[list[list[str]]] = None
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

class ItemPatch(BaseModel):
    name: str
    under: Optional[list[str]] = None
    new_name: Optional[str] = None
    qty: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None

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

_EXEC_ARGS: dict[str, type] = {"create": CreateArgs, "update": UpdateArgs, "remove": RemoveArgs}


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
        prefix = ("在 /" + "/".join(_segs(under)) + " 下") if under else ""
        raise ValueError(f"{prefix}没有找到物品「{name}」")
    return best


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
        "SELECT name, type_tag, parent_id FROM spaces WHERE id = ? AND owner_id = ?",
        (space_id, user_id),
    ).fetchone()
    if not r:
        return None
    return {"op": "patch_space", "space_id": space_id,
            "old": {"name": r["name"], "type_tag": r["type_tag"], "parent_id": r["parent_id"]}}


def _def_patch_op(conn, user_id: int, def_id: int) -> dict | None:
    r = conn.execute(
        "SELECT name, unit FROM item_defs WHERE id = ? AND owner_id = ?", (def_id, user_id)
    ).fetchone()
    if not r:
        return None
    return {"op": "patch_def", "def_id": def_id, "old": {"name": r["name"], "unit": r["unit"]}}


def _created_path(conn, user_id: int, path, ctx: dict) -> int:
    """mkdir -p a path; every newly created space is recorded as a reverse op."""
    parent: Optional[int] = None
    leaf: Optional[int] = None
    for name in _segs(path):
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
            cur = conn.execute(
                "INSERT INTO spaces (parent_id, name, name_norm, ord, type_tag, owner_id) "
                "VALUES (?, ?, ?, 0, 'generic', ?)",
                (parent, name, n, user_id),
            )
            node_id = int(cur.lastrowid)
            ctx["undo"].append({"ops": [{"op": "remove_space", "space_id": node_id}]})
        parent = node_id
        leaf = node_id
    return int(leaf)


def _register_with_undo(conn, u: int, name: str, space_id: int, qty: int, ctx: dict, **kw) -> dict:
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
        ctx["undo"].append({"ops": [{"op": "remove_lot", "lot_id": out["lot"]["lot_id"]}]})
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
            "UPDATE spaces SET name = ?, name_norm = ?, type_tag = ?, parent_id = ?, updated_at = datetime('now') "
            "WHERE id = ? AND owner_id = ?",
            (old["name"], norm_text(old["name"]), old["type_tag"], old["parent_id"], op["space_id"], user_id),
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
        counts["lots"] += 1
    elif kind == "remove_space":
        spaces_service.delete(conn, user_id, op["space_id"])
        counts["spaces"] += 1
    elif kind == "clear_image":
        media_service.delete(conn, user_id, op["entity_type"], op["entity_id"])
        counts["images"] += 1


def restore_undo(conn, user_id: int, bundles: list[dict]) -> dict:
    """Undo one run: snapshot bundles re-insert deleted rows, op bundles reverse
    mutations. Replayed LIFO — undo the newest change first and tear down created
    spaces last, so a cascade can never eat a row an earlier op still needs."""
    counts = {"spaces": 0, "lots": 0, "attrs": 0, "images": 0}
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
def _p(path) -> str:
    return "/" + "/".join(_segs(path))


def _exec_create(conn, u: int, a: CreateArgs, ctx: dict) -> list[dict]:
    lines: list[dict] = []
    for path in a.spaces or []:
        try:
            _created_path(conn, u, path, ctx)
            lines.append({"ok": True, "text": f"已建空间 {_p(path)}"})
        except Exception as e:  # noqa: BLE001
            lines.append({"ok": False, "text": f"建空间 {_p(path)}：{e}"})
    for it in a.items or []:
        try:
            sid = _created_path(conn, u, it.at, ctx)
            _register_with_undo(conn, u, it.name.strip(), sid, max(1, it.qty), ctx,
                                unit=it.unit, notes=it.notes, status=it.status or "present",
                                category=it.category)
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
            parts = [x for x in (sp.name, sp.type_tag) if x]
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
            if ops:
                ctx["undo"].append({"ops": ops})
            fields = {k: v for k, v in {
                "qty": it.qty, "status": it.status, "notes": it.notes}.items() if v is not None}
            if fields:
                items_service.patch(conn, u, lot["lot_id"], **fields)
            if it.category:
                conn.execute(
                    "UPDATE item_defs SET category_id = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
                    (_category_id(conn, u, it.category), lot["def_id"], u),
                )
            changed = [k for k, v in {
                "名": it.new_name, "量": it.qty, "状态": it.status,
                "注": it.notes, "类": it.category, "单位": it.unit}.items() if v is not None]
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


def apply_plan(user_id: int, plan: list[dict]) -> tuple[list, int | None]:
    """Execute a validated plan sequentially in one transaction (no step cap)."""
    runners = {"create": _exec_create, "update": _exec_update, "remove": _exec_remove}
    ctx: dict = {"undo": []}
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
READ_TREE = ("read_tree", "读取目录树(可选某路径之下),含每个空间里的物品。规划前用它了解结构,不要猜路径。", {
    "type": "object",
    "properties": {"path": {"type": "array", "items": {"type": "string"},
                            "description": "可选,如 ['宿舍','书桌'];不传=整棵树"}},
    "required": [],
})
SUBMIT_PLAN = ("submit_plan", "提交执行方案(等待用户确认后才会执行)。steps 每项 {tool, args}:"
    "tool=create args={spaces:[[路径]...], items:[{name, at:[路径], qty?, unit?, category?, notes?, status?}]};"
    "tool=update args={moves:[{from_path:[...],to_path:[...]}], item_moves:[{name,under?,to_path:[...]}], "
    "spaces:[{path:[...],name?,type_tag?}], items:[{name,under?,new_name?,qty?,status?,notes?,category?,unit?}], "
    "to_items:[[路径]]};"
    "tool=remove args={spaces:[[路径]...], items:[{name,under?}]}。"
    "同类操作放进同一个数组分批批量;只有存在先后依赖才拆步骤。", {
    "type": "object",
    "properties": {"steps": {"type": "array", "items": {
        "type": "object",
        "properties": {"tool": {"type": "string", "enum": ["create", "update", "remove"]},
                       "args": {"type": "object"}},
        "required": ["tool", "args"]}}},
    "required": ["steps"],
})

_PLAN_TOOLS = [READ_TREE, SUBMIT_PLAN]


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


def _plan_read(user_id: int, args: dict) -> str:
    try:
        with read() as conn:
            return _read_tree_text(conn, user_id, args.get("path"))
    except ValueError as e:
        return str(e)


def plan_agent(base_url, api_key, model, user_id, message, attachments) -> tuple[list, str]:
    """Returns (plan_steps_raw, reply). Only reads happen here — nothing mutates."""
    if "anthropic.com" in base_url:
        return _plan_anthropic(base_url, api_key, model, user_id, message, attachments)
    return _plan_openai(base_url, api_key, model, user_id, message, attachments)


def _plan_openai(base_url, api_key, model, user_id, message, attachments) -> tuple[list, str]:
    client = OpenAI(base_url=base_url, api_key=api_key or "sk-local")
    tools = [{"type": "function", "function": {"name": n, "description": d, "parameters": p}}
             for n, d, p in _PLAN_TOOLS]
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": _user_content(message, attachments, False)},
    ]
    for _ in range(30):  # runaway guard for the read loop; planning ends at submit_plan
        resp = client.chat.completions.create(model=model, messages=messages, tools=tools,
                                              tool_choice="auto", max_tokens=2000, temperature=0.2)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return [], msg.content or "(没有给出执行方案)"
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
                return args.get("steps") or [], msg.content or ""
            out = _plan_read(user_id, args) if tc.function.name == "read_tree" else f"未知工具 {tc.function.name}"
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})
    return [], "(没能形成执行方案，请换个说法或更具体一点)"


def _plan_anthropic(base_url, api_key, model, user_id, message, attachments) -> tuple[list, str]:
    client = anthropic.Anthropic(api_key=api_key or "sk-local")
    tools = [{"name": n, "description": d, "input_schema": p} for n, d, p in _PLAN_TOOLS]
    messages = [{"role": "user", "content": _user_content(message, attachments, True)}]
    for _ in range(30):
        resp = client.messages.create(model=model, system=SYSTEM, messages=messages,
                                      tools=tools, max_tokens=2000, temperature=0.2)
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            return [], "".join(b.text for b in resp.content if b.type == "text") or "(没有给出执行方案)"
        messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        results = []
        for b in tool_uses:
            if b.name == "submit_plan":
                plan = (b.input or {}).get("steps") or []
                text = "".join(x.text for x in resp.content if x.type == "text")
                if plan:
                    return plan, text
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": "方案为空,请再给一次"})
                continue
            out = _plan_read(user_id, b.input or {}) if b.name == "read_tree" else f"未知工具 {b.name}"
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": out})
        messages.append({"role": "user", "content": results})
    return [], "(没能形成执行方案，请换个说法或更具体一点)"
