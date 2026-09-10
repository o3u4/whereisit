import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset(client):
    from app.db.engine import tx
    from app.domains.settings import service

    yield
    with tx() as conn:
        service.clear_token(conn, 1)
        for t in ["attrs", "item_lots", "item_aliases", "item_defs", "categories", "spaces", "images"]:
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM user_tokens WHERE user_id NOT IN (1)")
        conn.execute("DELETE FROM users WHERE id NOT IN (1)")


def _ensure(client, names):
    r = client.post("/api/spaces/ensure-path", json={"names": names})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _tree(client):
    return client.get("/api/spaces/tree").json()["data"]


def _names(tree):
    return [n["name"] for n in tree]


def test_ensure_path_creates_full_chain(client):
    leaf = _ensure(client, ["客厅", "储物柜", "顶层"])
    tree = _tree(client)
    assert _names(tree) == ["客厅"]
    assert _names(tree[0]["children"]) == ["储物柜"]
    assert _names(tree[0]["children"][0]["children"]) == ["顶层"]
    assert leaf == tree[0]["children"][0]["children"][0]["id"]


def test_ensure_path_reuses_existing_prefix(client):
    _ensure(client, ["书房", "衣柜"])
    leaf = _ensure(client, ["书房", "衣柜", "顶层"])
    tree = _tree(client)
    # no duplicate 书房/衣柜 created
    assert _names(tree) == ["书房"]
    assert _names(tree[0]["children"]) == ["衣柜"]
    assert _names(tree[0]["children"][0]["children"]) == ["顶层"]
    assert leaf == tree[0]["children"][0]["children"][0]["id"]


def test_ensure_path_idempotent(client):
    a = _ensure(client, ["抽屉", "左侧"])
    b = _ensure(client, ["抽屉", "左侧"])
    assert a == b
    assert _names(_tree(client)) == ["抽屉"]


def test_ensure_path_normalizes_case(client):
    _ensure(client, ["客厅"])
    # same name under the root, differently cased → same node
    same = _ensure(client, ["客厅"])
    tree = _tree(client)
    assert _names(tree) == ["客厅"]
    assert tree[0]["id"] == same


def test_ensure_path_empty_rejected(client):
    # empty list is rejected by the schema (422); a blank segment by the service (400)
    assert client.post("/api/spaces/ensure-path", json={"names": []}).status_code in (400, 422)
    assert client.post("/api/spaces/ensure-path", json={"names": ["a", " ", "b"]}).status_code == 400


def test_ensure_path_updates_type_on_reuse(client):
    a = _ensure(client, ["客厅"])
    r = client.get("/api/spaces/tree").json()["data"]
    assert r[0]["type_tag"] == "generic"
    # re-add the same space choosing a different type → it updates
    b = client.post("/api/spaces/ensure-path", json={"names": ["客厅"], "type_tag": "room"}).json()["data"]["id"]
    assert a == b
    assert client.get("/api/spaces/tree").json()["data"][0]["type_tag"] == "room"


def test_build_tree_creates_structure(client):
    payload = {
        "parent_id": None,
        "nodes": [
            {
                "name": "卧室",
                "children": [{"name": "衣柜", "items": [{"name": "外套", "qty": 2}, {"name": "毛衣", "category": "衣物"}]}],
                "items": [{"name": "床", "unit": "张"}],
            }
        ],
    }
    r = client.post("/api/spaces/build-tree", json=payload)
    assert r.status_code == 201, r.text
    d = r.json()["data"]["created"]
    assert d["spaces"] >= 2
    assert d["items"] == 3

    tree = client.get("/api/spaces/tree").json()["data"]
    assert tree[0]["name"] == "卧室"
    assert tree[0]["children"][0]["name"] == "衣柜"
    names = [i["name"] for i in client.get("/api/items").json()["data"]]
    assert "外套" in names and "毛衣" in names and "床" in names

    # re-building the same tree creates no extra spaces/layers (find-or-create)
    assert client.post("/api/spaces/build-tree", json=payload).status_code == 201
    tree2 = client.get("/api/spaces/tree").json()["data"]
    assert len(tree2) == 1 and len(tree2[0]["children"]) == 1


def test_ensure_path_isolated_per_user(client):
    _ensure(client, ["客厅"])

    root = client.post("/api/settings/token").json()["data"]["token"]
    h_root = {"Authorization": f"Bearer {root}"}
    alice = client.post("/api/admin/users", json={"username": "alice"}, headers=h_root).json()["data"]
    h_alice = {"Authorization": f"Bearer {alice['token']}"}

    res = client.post("/api/spaces/ensure-path", json={"names": ["客厅", "储物柜"]}, headers=h_alice)
    assert res.status_code == 201
    # alice's "客厅/储物柜" is separate from root's "客厅"
    assert _names(client.get("/api/spaces/tree", headers=h_alice).json()["data"]) == ["客厅"]
    assert _names(client.get("/api/spaces/tree", headers=h_alice).json()["data"][0]["children"]) == ["储物柜"]
    assert _names(client.get("/api/spaces/tree", headers=h_root).json()["data"]) == ["客厅"]