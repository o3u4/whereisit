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


def _cats(client: TestClient) -> list[dict]:
    return client.get("/api/categories").json()["data"]


def _make_cat(client: TestClient, name: str) -> dict:
    r = client.post("/api/categories", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_list_empty_then_create(client):
    assert _cats(client) == []
    node = _make_cat(client, "工具甲")
    assert node["name"] == "工具甲"
    cats = _cats(client)
    assert [c["name"] for c in cats] == ["工具甲"] and cats[0]["item_count"] == 0


def test_create_is_find_or_create(client):
    a = _make_cat(client, "工具乙")
    b = _make_cat(client, "工具乙")
    assert a["id"] == b["id"]


def test_register_creates_category_with_count(client):
    s = _space(client, "柜甲")
    r = client.post("/api/items/register", json={"name": "扳手", "space_id": s["id"], "category": "工具丙"})
    assert r.status_code == 201, r.text
    cat = next(c for c in _cats(client) if c["name"] == "工具丙")
    assert cat["item_count"] == 1


def test_rename_reflects_into_items(client):
    s = _space(client, "柜乙")
    client.post("/api/items/register", json={"name": "锤头", "space_id": s["id"], "category": "工具丁"})
    cat = next(c for c in _cats(client) if c["name"] == "工具丁")

    r = client.patch(f"/api/categories/{cat['id']}", json={"name": "五金"})
    assert r.status_code == 200, r.text
    item = client.get("/api/items").json()["data"][0]
    assert item["category"] == "五金"
    assert "工具丁" not in [c["name"] for c in _cats(client)]


def test_delete_empty(client):
    cat = _make_cat(client, "空类")
    r = client.delete(f"/api/categories/{cat['id']}")
    assert r.status_code == 200, r.text
    assert "空类" not in [c["name"] for c in _cats(client)]


def test_delete_with_items_requires_destination(client):
    s = _space(client, "柜丙")
    client.post("/api/items/register", json={"name": "螺丝刀", "space_id": s["id"], "category": "占位甲"})
    cat = next(c for c in _cats(client) if c["name"] == "占位甲")
    assert client.delete(f"/api/categories/{cat['id']}").status_code == 409


def test_delete_reassigns_items_into_destination(client):
    s = _space(client, "柜丁")
    client.post("/api/items/register", json={"name": "梯子", "space_id": s["id"], "category": "占位乙"})
    from_cat = next(c for c in _cats(client) if c["name"] == "占位乙")
    into_cat = _make_cat(client, "收纳类")

    r = client.delete(f"/api/categories/{from_cat['id']}", params={"into_id": into_cat["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["removed_id"] == from_cat["id"]
    item = client.get("/api/items").json()["data"][0]
    assert item["category"] == "收纳类"
    assert from_cat["id"] not in [c["id"] for c in _cats(client)]