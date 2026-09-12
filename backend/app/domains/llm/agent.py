from __future__ import annotations

import base64
import json

import anthropic
import openai
from openai import OpenAI

from app.core.config import MEDIA_DIR
from app.db.engine import tx
from app.domains.items import service as items_service
from app.domains.media import service as media_service
from app.domains.spaces import service as spaces_service

SYSTEM = """You are whereisit's catalog assistant. The user asks you to organize their item
catalog. You call tools to read and modify it — work only with what actually
exists (use find_item / list_tree first when unsure). Reply in the user's
language, and end with a one-line summary of what you changed.

Rules:
- To locate a thing, call find_item and operate on the match(es).
- When the user mentions lending/borrowing with a return (e.g. 3天后还), set the
  status to 'lent' and note the due date.
- Deletion is allowed ONLY for restructuring a folder (e.g. after moving things,
  remove a now-empty/duplicate container) — never a plain delete.
- Never ask the user for input mid-task; do the reasonable thing and summarize."""

_EMPTY = {"type": "object", "properties": {}, "required": []}


def _tree_summary(conn, user_id: int, root_id=None) -> str:
    def walk(nodes, depth):
        out = []
        for n in nodes:
            cnt = conn.execute(
                "SELECT COUNT(*) c FROM item_lots WHERE space_id = ? AND owner_id = ?",
                (n["id"], user_id),
            ).fetchone()["c"]
            out.append(f"{'  ' * depth}- {n['name']}（{len(n['children'])} 子 / {cnt} 物）")
            out += walk(n["children"], depth + 1)
        return out

    tree = spaces_service.tree(conn, user_id, root_id)
    return "\n".join(walk(tree, 0)) or "（空）"


def _find_lot(conn, user_id: int, name: str):
    name = (name or "").strip().lower()
    if not name:
        return None
    for it in items_service.list_all(conn, user_id):
        if it["name"].lower() == name or name in it["name"].lower():
            return it
    return None


# ------------------------------------------------------------------ undo ----
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
    attrs = []
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


def _image_snapshot(user_id: int, img_row) -> dict:
    p = MEDIA_DIR / str(user_id) / img_row["file_path"]
    data = base64.b64encode(p.read_bytes()).decode() if p.exists() else ""
    return {"entity_type": img_row["entity_type"], "entity_id": img_row["entity_id"],
            "file_path": img_row["file_path"], "mime": img_row.get("mime"), "bytes_b64": data}


def restore_undo(conn, user_id: int, bundles: list[dict]) -> dict:
    """Restore every captured delete bundle; returns aggregate counts."""
    counts = {"spaces": 0, "lots": 0, "attrs": 0, "images": 0}
    for data in bundles:
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
    return counts


# ------------------------------------------------------------------ tools ----
_TOOLS: list[dict] = []


def _tool(name, description, parameters, run):
    _TOOLS.append({"name": name, "description": description, "parameters": parameters, "run": run})


_tool("list_tree", "列出当前目录树(名称/子数/物数),了解结构。", {
    "type": "object",
    "properties": {"root_id": {"type": "integer", "description": "可选,默认顶层"}},
    "required": [],
}, lambda conn, u, a, c: _tree_summary(conn, u, a.get("root_id")))

_tool("find_item", "按名称查找物品(可模糊)。", {
    "type": "object",
    "properties": {"name": {"type": "string", "description": "物品名称关键词"}},
    "required": ["name"],
}, lambda conn, u, a, c: _fmt_matches(conn, u, a.get("name")))


def _fmt_matches(conn, user_id, name) -> str:
    it = _find_lot(conn, user_id, name)
    if not it:
        return "没有找到「%s」" % (name or "")
    return f"找到：{it['name']} ×{it['qty']}（{it['status']}）~/{it['space_id']}"


def _path_id(conn, user_id, path) -> int:
    if isinstance(path, str):
        segs = [s.strip() for s in path.replace("\\", "/").split("/") if s.strip()]
    else:
        segs = [str(s).strip() for s in (path or []) if str(s).strip()]
    if not segs:
        raise ValueError("路径为空")
    return spaces_service.ensure_path(conn, user_id, segs)


_tool("create_space", "创建(或找到)一串路径/目录。", {
    "type": "object",
    "properties": {"path": {"type": "array", "items": {"type": "string"}, "description": "如 ['客厅','衣柜'] 或传单段 ['抽屉']"}},
    "required": ["path"],
}, lambda conn, u, a, c: f"已创建/确认路径（叶 id={_path_id(conn, u, a['path'])}）")

_tool("register_item", "登记一个物品到某路径。", {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "path": {"type": "array", "items": {"type": "string"}},
        "qty": {"type": "integer"},
        "category": {"type": "string"},
        "unit": {"type": "string"},
        "notes": {"type": "string"},
        "status": {"type": "string", "enum": ["present", "lent", "consumed"]},
    },
    "required": ["name", "path"],
}, lambda conn, u, a, c: _register(conn, u, a))


def _register(conn, u, a) -> str:
    sid = _path_id(conn, u, a["path"])
    items_service.register(
        conn, u, name=a["name"], space_id=sid, qty=int(a.get("qty") or 1),
        category=a.get("category"), unit=a.get("unit"), notes=a.get("notes"),
        status=a.get("status") or "present",
    )
    return f"已登记 {a['name']} ×{int(a.get('qty') or 1)}"


def _lot_of(conn, u, a, ctx) -> str:
    it = _find_lot(conn, u, a.get("name"))
    if not it:
        return "没有找到「%s」" % a.get("name")
    return it


_tool("rename_item", "重命名物品(该物品类型的所有在库一起变)。", {
    "type": "object",
    "properties": {"name": {"type": "string"}, "new_name": {"type": "string"}},
    "required": ["name", "new_name"],
}, lambda conn, u, a, c: _rename(conn, u, a))


def _rename(conn, u, a) -> str:
    it = _find_lot(conn, u, a["name"])
    if not it:
        return "没有找到「%s」" % a["name"]
    items_service.rename_def(conn, u, def_id=it["def_id"], name=a["new_name"])
    return f"已改名 {it['name']} → {a['new_name']}"


_tool("set_status", "设置物品状态:在库/借出/用完;若借出可带归还期限。", {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "status": {"type": "string", "enum": ["present", "lent", "consumed"]},
        "due": {"type": "string", "description": "如 3天后 / 下周一 归还,会记进备注"},
    },
    "required": ["name", "status"],
}, lambda conn, u, a, c: _set_status(conn, u, a))


def _set_status(conn, u, a) -> str:
    it = _find_lot(conn, u, a["name"])
    if not it:
        return "没有找到「%s」" % a["name"]
    items_service.patch(conn, u, it["lot_id"], status=a["status"])
    out = f"已将 {it['name']} 状态设为 {a['status']}"
    if a.get("due"):
        note = it["notes"] or ""
        items_service.patch(conn, u, it["lot_id"], notes=(note + f"【借出,{a['due']}后归还】").strip())
        out += f",备注记了归还: {a['due']}后归还"
    return out


_tool("set_notes", "设置物品备注。", {
    "type": "object",
    "properties": {"name": {"type": "string"}, "notes": {"type": "string"}},
    "required": ["name", "notes"],
}, lambda conn, u, a, c: _set_notes(conn, u, a))


def _set_notes(conn, u, a) -> str:
    it = _find_lot(conn, u, a["name"])
    if not it:
        return "没有找到「%s」" % a["name"]
    items_service.patch(conn, u, it["lot_id"], notes=a["notes"])
    return f"已更新 {it['name']} 的备注"


_tool("move_item", "把物品移动到某路径。", {
    "type": "object",
    "properties": {"name": {"type": "string"}, "to_path": {"type": "array", "items": {"type": "string"}}},
    "required": ["name", "to_path"],
}, lambda conn, u, a, c: _move(conn, u, a))


def _move(conn, u, a) -> str:
    it = _find_lot(conn, u, a["name"])
    if not it:
        return "没有找到「%s」" % a["name"]
    sid = _path_id(conn, u, a["to_path"])
    items_service.patch(conn, u, it["lot_id"], space_id=sid)
    return f"已把 {it['name']} 移到新路径"


_tool("set_image", "把本次上传的图片设为该物品的预览图。", {
    "type": "object",
    "properties": {"name": {"type": "string"}},
    "required": ["name"],
}, lambda conn, u, a, c: _set_image(conn, u, a, c))


def _set_image(conn, u, a, ctx) -> str:
    if not ctx.get("attachments"):
        return "没有可用的上传图片附件"
    it = _find_lot(conn, u, a["name"])
    if not it:
        return "没有找到「%s」" % a["name"]
    media_service.put(conn, u, "lot", it["lot_id"], "agent.png", ctx["attachments"][0], "image/jpeg")
    return f"已为 {it['name']} 设置预览图"


_tool("delete_item", "删除一个物品(仅允许用于整理结构时清理重复/空项)。", {
    "type": "object",
    "properties": {"name": {"type": "string"}},
    "required": ["name"],
}, lambda conn, u, a, c: _delete_item(conn, u, a, c))


def _delete_item(conn, u, a, ctx) -> str:
    it = _find_lot(conn, u, a["name"])
    if not it:
        return "没有找到「%s」" % a["name"]
    _capture_lot(conn, u, it["lot_id"], ctx)
    items_service.remove(conn, u, lot_id=it["lot_id"])
    return f"已删除 {it['name']}"


_tool("delete_space", "删除一个空间/目录及其内容(仅允许用于整理结构,如清空后合并)。", {
    "type": "object",
    "properties": {"path": {"type": "array", "items": {"type": "string"}}},
    "required": ["path"],
}, lambda conn, u, a, c: _delete_space(conn, u, a, c))


def _delete_space(conn, u, a, ctx) -> str:
    sid = _path_id(conn, u, a["path"])
    _capture_space(conn, u, sid, ctx)
    spaces_service.delete(conn, u, sid)
    return "已删除该目录(可在结果里撤销)"


_TOOLS_BY_NAME = {t["name"]: t for t in _TOOLS}


def _run_tool(conn, user_id, name, args, ctx) -> str:
    tool = _TOOLS_BY_NAME.get(name)
    if not tool:
        return f"未知工具 {name}"
    try:
        return str(tool["run"](conn, user_id, args, ctx))
    except Exception as e:  # noqa: BLE001
        return f"执行出错: {e}"


# ------------------------------------------------------------- agent loop ----
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


def _persist_undo(user_id: int, ctx: dict) -> int | None:
    if not ctx.get("undo"):
        return None
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO agent_undo (user_id, data_json) VALUES (?, ?)",
            (user_id, json.dumps(ctx["undo"], ensure_ascii=False)),
        )
        return int(cur.lastrowid)


def run_agent(base_url, api_key, model, user_id, message, attachments) -> tuple:
    """Returns (steps, reply, undo_id). steps: list of {tool,args,result}."""
    ctx = {"attachments": [base64.b64decode(a["image_base64"]) for a in (attachments or []) if a.get("image_base64")], "undo": []}
    steps: list[dict] = []
    if "anthropic.com" in base_url:
        reply = _loop_anthropic(base_url, api_key, model, user_id, message, attachments, ctx, steps)
    else:
        reply = _loop_openai(base_url, api_key, model, user_id, message, attachments, ctx, steps)
    undo_id = _persist_undo(user_id, ctx)
    return steps, reply, undo_id


def _loop_openai(base_url, api_key, model, user_id, message, attachments, ctx, steps) -> str:
    client = OpenAI(base_url=base_url, api_key=api_key or "sk-local")
    tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}} for t in _TOOLS]
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": _user_content(message, attachments, False)},
    ]
    for _ in range(6):
        resp = client.chat.completions.create(model=model, messages=messages, tools=tools, tool_choice="auto", max_tokens=1200, temperature=0.2)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return msg.content or "(无回复)"
        messages.append({
            "role": "assistant", "content": msg.content or "",
            "tool_calls": [{"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in msg.tool_calls],
        })
        with tx() as conn:
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args = {}
                result = _run_tool(conn, user_id, tc.function.name, args, ctx)
                steps.append({"tool": tc.function.name, "args": args, "result": result})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    return "(已达步骤上限,请再具体一点)"


def _loop_anthropic(base_url, api_key, model, user_id, message, attachments, ctx, steps) -> str:
    client = anthropic.Anthropic(api_key=api_key or "sk-local")
    tools = [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in _TOOLS]
    messages = [{"role": "user", "content": _user_content(message, attachments, True)}]
    for _ in range(6):
        resp = client.messages.create(model=model, system=SYSTEM, messages=messages, tools=tools, max_tokens=1200, temperature=0.2)
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            return "".join(b.text for b in resp.content if b.type == "text") or "(无回复)"
        messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        with tx() as conn:
            results = []
            for b in tool_uses:
                args = b.input or {}
                result = _run_tool(conn, user_id, b.name, args, ctx)
                steps.append({"tool": b.name, "args": args, "result": result})
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": result})
            messages.append({"role": "user", "content": results})
    return "(已达步骤上限,请再具体一点)"