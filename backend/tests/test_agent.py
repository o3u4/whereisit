import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _flush(client):
    from app.db.engine import tx

    yield
    with tx() as conn:
        conn.execute("DELETE FROM settings WHERE key IN ('llm_base_url', 'llm_model')")
        conn.execute("DELETE FROM secrets WHERE key = 'llm_api_key'")
        for t in ["attrs", "item_lots", "item_aliases", "item_defs", "categories", "spaces", "agent_undo", "images"]:
            conn.execute(f"DELETE FROM {t}")


def _tc(tid, name, args):
    return SimpleNamespace(id=tid, type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)))


def _msg(tool_calls=None, content=""):
    return SimpleNamespace(content=content, tool_calls=tool_calls)


class _FakeOpenAI:
    def __init__(self, script):
        self._script = script
        self._i = 0

    @property
    def chat(self):
        return SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        m = self._script[min(self._i, len(self._script) - 1)]
        self._i += 1
        return SimpleNamespace(choices=[SimpleNamespace(message=m)])


def _setup(client):
    assert client.put("/api/settings", json={"llm_base_url": "http://x/v1", "llm_model": "m"}).status_code == 200
    sp = client.post("/api/spaces", json={"name": "抽屉", "type_tag": "generic"}).json()["data"]
    client.post("/api/items/register", json={"name": "钥匙", "space_id": sp["id"]}).json()
    return sp


def _plan_and_apply(client, monkeypatch, script):
    import app.domains.llm.agent as ag

    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    p = client.post("/api/llm/agent/plan", json={"message": "x"})
    assert p.status_code == 200, p.text
    d = p.json()["data"]
    assert d["steps"], d
    r = client.post("/api/llm/agent/apply", json={"plan": d["steps"]})
    assert r.status_code == 200, r.text
    return d, r.json()["data"]


def test_agent_unconfigured_is_503(client):
    assert client.post("/api/llm/agent/plan", json={"message": "x"}).status_code == 503


def test_plan_reads_tree_then_submits(client, monkeypatch):
    import app.domains.llm.agent as ag

    _setup(client)
    script = [
        _msg(tool_calls=[_tc("1", "read_tree", {})]),
        _msg(tool_calls=[_tc("2", "submit_plan", {"steps": [
            {"tool": "update", "args": {"items": [{"name": "钥匙", "status": "lent", "notes": "3天后归还"}]}}]})],
            content="把钥匙记为借出"),
    ]
    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    p = client.post("/api/llm/agent/plan", json={"message": "把钥匙记成借出，3天后还"})
    assert p.status_code == 200, p.text
    d = p.json()["data"]
    assert d["reply"] == "把钥匙记为借出"
    assert d["steps"] == [{"tool": "update", "args": {"items": [{"name": "钥匙", "status": "lent", "notes": "3天后归还"}]}}]

    # plan phase must not have touched data
    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["status"] == "present"


def test_plan_rejects_bad_tool(client, monkeypatch):
    import app.domains.llm.agent as ag

    _setup(client)
    script = [_msg(tool_calls=[_tc("1", "submit_plan", {"steps": [{"tool": "find_item", "args": {}}]})])]
    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    assert client.post("/api/llm/agent/plan", json={"message": "x"}).status_code == 400


def test_apply_status_and_undo(client):
    _setup(client)
    plan = [{"tool": "update", "args": {"items": [{"name": "钥匙", "status": "lent", "notes": "3天后归还"}]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["undo_id"] is not None
    assert d["results"][0]["lines"][0]["ok"] is True

    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["status"] == "lent"
    assert "3天后" in (kit["notes"] or "")

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["status"] == "present"
    assert not (kit["notes"] or "")


def test_apply_create_move_remove_then_undo(client):
    sp = _setup(client)
    plan = [
        {"tool": "create", "args": {"spaces": [["柜子", "顶格"]],
         "items": [{"name": "便签", "at": ["抽屉"], "qty": 2}]}},
        {"tool": "update", "args": {"item_moves": [{"name": "钥匙", "to_path": ["柜子", "顶格"]}]}},
        {"tool": "remove", "args": {"items": [{"name": "便签"}]}},
    ]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    items = client.get("/api/items").json()["data"]
    kit = [i for i in items if i["name"] == "钥匙"][0]
    assert kit["space_id"] != sp["id"]
    assert "便签" not in [i["name"] for i in items]
    tree_names = {n["name"] for n in client.get("/api/spaces/tree").json()["data"]}
    assert "柜子" in tree_names

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    items = client.get("/api/items").json()["data"]
    kit = [i for i in items if i["name"] == "钥匙"][0]
    assert kit["space_id"] == sp["id"]
    assert "便签" not in [i["name"] for i in items]
    tree_names = {n["name"] for n in client.get("/api/spaces/tree").json()["data"]}
    assert "柜子" not in tree_names


def _tree_names(nodes, acc=None):
    acc = set() if acc is None else acc
    for n in nodes:
        acc.add(n["name"])
        _tree_names(n.get("children") or [], acc)
    return acc


def test_apply_to_item_then_undo(client):
    root = client.post("/api/spaces", json={"name": "桌面"}).json()["data"]
    leaf = client.post("/api/spaces", json={"name": "笔筒", "parent_id": root["id"]}).json()["data"]
    client.post("/api/items/register", json={"name": "铅笔", "space_id": leaf["id"], "qty": 3})

    plan = [{"tool": "update", "args": {"to_items": [["桌面", "笔筒"]]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert "笔筒" not in _tree_names(client.get("/api/spaces/tree").json()["data"])
    items = client.get("/api/items").json()["data"]
    assert {i["name"] for i in items} == {"铅笔", "笔筒"}

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    assert "笔筒" in _tree_names(client.get("/api/spaces/tree").json()["data"])
    items = client.get("/api/items").json()["data"]
    assert {i["name"] for i in items} == {"铅笔"}


def test_apply_missing_path_reports_error(client):
    _setup(client)
    plan = [{"tool": "update", "args": {"item_moves": [{"name": "钥匙", "to_path": ["不存在", "路径"]}]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    lines = r.json()["data"]["results"][0]["lines"]
    assert lines[0]["ok"] is False
    assert "不存在" in lines[0]["text"]
    # item untouched
    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["space_id"]


def test_apply_category_ops_then_undo(client):
    plan = [
        {"tool": "category", "args": {"add": ["电子", "数码"]}},
        {"tool": "create", "args": {"items": [
            {"name": "台灯", "at": ["桌面"], "category": "电子", "attrs": [["颜色", "白"]]}]}},
        {"tool": "category", "args": {"merge": [{"source": "数码", "into": "电子"}]}},
    ]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert {c["name"] for c in client.get("/api/categories").json()["data"]} == {"电子"}
    assert "数码" not in {c["name"] for c in client.get("/api/categories").json()["data"]}

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    assert client.get("/api/categories").json()["data"] == []
    assert client.get("/api/items").json()["data"] == []


def test_apply_merge_defs_then_undo(client):
    sp = client.post("/api/spaces", json={"name": "桌面"}).json()["data"]
    client.post("/api/items/register", json={"name": "钥匙", "space_id": sp["id"]})
    client.post("/api/items/register", json={"name": "锁匙", "space_id": sp["id"]})
    plan = [{"tool": "merge_defs", "args": {"target": "钥匙", "sources": ["锁匙"]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    names = {i["name"] for i in client.get("/api/items").json()["data"]}
    assert names == {"钥匙"}

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    names = {i["name"] for i in client.get("/api/items").json()["data"]}
    assert names == {"钥匙", "锁匙"}


def test_apply_reorder_then_undo(client):
    root = client.post("/api/spaces", json={"name": "桌面"}).json()["data"]
    a = client.post("/api/spaces", json={"name": "甲", "parent_id": root["id"]}).json()["data"]
    b = client.post("/api/spaces", json={"name": "乙", "parent_id": root["id"]}).json()["data"]
    order = lambda: [n["name"] for n in client.get(f"/api/spaces/tree?root_id={root['id']}").json()["data"][0]["children"]]
    assert order() == ["甲", "乙"]

    plan = [{"tool": "reorder", "args": {"path": ["桌面"], "spaces": ["乙", "甲"]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert order() == ["乙", "甲"]

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    assert order() == ["甲", "乙"]


def test_apply_status_synonyms_and_scene_group(client):
    plan = [
        {"tool": "create", "args": {"spaces": [{"path": ["卧室"], "type_tag": "room", "group": "家"}]}},
        {"tool": "create", "args": {"items": [{"name": "蓝牙耳机", "at": ["卧室"], "status": "借出"}]}},
        {"tool": "update", "args": {"items": [{"name": "蓝牙耳机", "status": "用完"}]}},
    ]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    for res in r.json()["data"]["results"]:
        assert res["lines"][0]["ok"] is True, res["lines"]

    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "蓝牙耳机"][0]
    assert kit["status"] == "consumed"

    tree = client.get("/api/spaces/tree").json()["data"]
    room = [n for n in tree if n["name"] == "卧室"][0]
    assert room["type_tag"] == "room"
    assert "家" in room["layout_json"]


def test_apply_bad_status_reports_error(client):
    _setup(client)
    plan = [{"tool": "update", "args": {"items": [{"name": "钥匙", "status": "已丢"}]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan})
    assert r.status_code == 200, r.text
    lines = r.json()["data"]["results"][0]["lines"]
    assert lines[0]["ok"] is False
    assert "无效" in lines[0]["text"]


def test_apply_set_image_then_undo(client):
    sp = _setup(client)
    plan = [{"tool": "set_image", "args": {"items": [{"name": "钥匙"}]}}]
    r = client.post("/api/llm/agent/apply", json={"plan": plan, "attachments": [{"image_base64": "QUFBQQ=="}]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["results"][0]["lines"][0]["ok"] is True
    assert d["undo_id"] is not None

    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    res = client.get(f"/api/media?entity_type=lot&entity_id={kit['lot_id']}")
    assert res.status_code == 200

    client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    res = client.get(f"/api/media?entity_type=lot&entity_id={kit['lot_id']}")
    assert res.status_code == 404
