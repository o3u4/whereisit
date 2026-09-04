import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _cleanup_new_spaces(client):
    before = {n["id"] for n in client.get("/api/spaces/tree").json()["data"]}
    yield
    for n in client.get("/api/spaces/tree").json()["data"]:
        if n["id"] not in before:
            client.delete(f"/api/spaces/{n['id']}?mode=cascade")


def _space(client: TestClient, name: str) -> dict:
    r = client.post("/api/spaces", json={"name": name, "type_tag": "generic"})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _reg(client: TestClient, name: str, space_id: int, **kw) -> dict:
    body = {"name": name, "space_id": space_id, **kw}
    r = client.post("/api/items/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]["lot"]


def _merge(client: TestClient, keep_id: int, from_id: int) -> dict:
    r = client.post(f"/api/items/defs/{keep_id}/merge", json={"from_id": from_id})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _items(client: TestClient) -> list[dict]:
    return client.get("/api/items").json()["data"]


def test_merge_folds_lots_aliases_attrs(client):
    s1 = _space(client, "格甲")
    s2 = _space(client, "格乙")
    keep = _reg(client, "甲物件", s1["id"], alias="one, 一号", category="工具", attrs=[{"key": "标签", "value": "红"}])
    src = _reg(client, "甲物体", s2["id"], alias="two, 二号", category="日用", attrs=[{"key": "材质", "value": "金属"}])

    data = _merge(client, keep["def_id"], src["def_id"])
    assert data["kept_id"] == keep["def_id"]
    assert data["removed_id"] == src["def_id"]
    assert data["lots_moved"] == 1
    assert data["aliases_added"] == 2
    assert data["attrs_added"] == 1

    # both presences now live under keep's name; def attrs are the union
    items = _items(client)
    assert len(items) == 2
    assert {i["name"] for i in items} == {"甲物件"}
    for i in items:
        d = dict(i["attrs"])
        assert d["标签"] == "红" and d["材质"] == "金属"

    # moved alias is searchable (alias moved onto keep)
    r = client.get("/api/search", params={"q": "two", "mode": "fuzzy"})
    assert r.status_code == 200
    assert any(i["name"] == "甲物件" for i in r.json()["data"]["items"])


def test_merge_unknown_def_404(client):
    s = _space(client, "格丙")
    keep = _reg(client, "丙件", s["id"])
    r = client.post(f"/api/items/defs/{keep['def_id']}/merge", json={"from_id": 999_999})
    assert r.status_code == 404
    r = client.post("/api/items/defs/999_999/merge", json={"from_id": keep["def_id"]})
    assert r.status_code == 404


def test_merge_into_itself_400(client):
    s = _space(client, "格丁")
    keep = _reg(client, "丁件", s["id"])
    r = client.post(f"/api/items/defs/{keep['def_id']}/merge", json={"from_id": keep["def_id"]})
    assert r.status_code == 400