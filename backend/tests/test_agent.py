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
    return SimpleNamespace(id=tid, type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args)))


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


def test_agent_unconfigured_is_503(client):
    assert client.post("/api/llm/agent", json={"message": "x"}).status_code == 503


def test_agent_find_then_set_status(client, monkeypatch):
    import app.domains.llm.agent as ag

    _setup(client)
    script = [
        _msg(tool_calls=[_tc("1", "find_item", {"name": "钥匙"}), _tc("2", "set_status", {"name": "钥匙", "status": "lent", "due": "3天后"})]),
        _msg(content="已把钥匙记为借出"),
    ]
    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    r = client.post("/api/llm/agent", json={"message": "把抽屉里的钥匙记成被借走了，3天后还"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["reply"] == "已把钥匙记为借出"
    tools = [s["tool"] for s in d["steps"]]
    assert "find_item" in tools and "set_status" in tools

    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["status"] == "lent"
    assert "3天后" in (kit["notes"] or "")


def test_agent_register_then_undo(client, monkeypatch):
    import app.domains.llm.agent as ag

    _setup(client)
    script = [
        _msg(tool_calls=[_tc("1", "register_item", {"name": "便签", "path": ["抽屉"], "qty": 2})]),
        _msg(content="已登记便签"),
    ]
    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    r = client.post("/api/llm/agent", json={"message": "在抽屉里记两本便签"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["undo_id"] is not None
    assert "便签" in [i["name"] for i in client.get("/api/items").json()["data"]]

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    assert "便签" not in [i["name"] for i in client.get("/api/items").json()["data"]]


def test_agent_move_create_space_status_then_undo(client, monkeypatch):
    import app.domains.llm.agent as ag

    sp = _setup(client)
    script = [
        _msg(tool_calls=[_tc("1", "move_item", {"name": "钥匙", "to_path": ["柜子", "顶格"]})]),
        _msg(tool_calls=[_tc("2", "set_status", {"name": "钥匙", "status": "lent", "due": "3天后"})]),
        _msg(content="done"),
    ]
    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    r = client.post("/api/llm/agent", json={"message": "把钥匙挪到柜子/顶格并记成借出，3天后还"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["undo_id"] is not None

    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["space_id"] != sp["id"]
    assert kit["status"] == "lent"

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    kit = [i for i in client.get("/api/items").json()["data"] if i["name"] == "钥匙"][0]
    assert kit["space_id"] == sp["id"]
    assert kit["status"] == "present"
    assert not (kit["notes"] or "")
    # the freshly created path is gone again
    names = {n["name"] for n in client.get("/api/spaces/tree").json()["data"]}
    assert "柜子" not in names


def test_agent_delete_then_undo(client, monkeypatch):
    import app.domains.llm.agent as ag

    sp = _setup(client)
    client.post("/api/items/register", json={"name": "剪刀", "space_id": sp["id"]}).json()
    script = [
        _msg(tool_calls=[_tc("1", "delete_item", {"name": "剪刀"})]),
        _msg(content="已删除剪刀"),
    ]
    monkeypatch.setattr(ag, "OpenAI", lambda *a, **k: _FakeOpenAI(script))
    r = client.post("/api/llm/agent", json={"message": "整理时把剪刀删了"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["undo_id"] is not None
    assert "剪刀" not in [i["name"] for i in client.get("/api/items").json()["data"]]

    u = client.post("/api/llm/agent/undo", json={"undo_id": d["undo_id"]})
    assert u.status_code == 200, u.text
    assert u.json()["data"]["restored"]["lots"] >= 1
    assert "剪刀" in [i["name"] for i in client.get("/api/items").json()["data"]]