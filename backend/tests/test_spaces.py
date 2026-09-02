import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _create(c: TestClient, name: str, parent=None, type_tag="generic") -> dict:
    body = {"name": name, "type_tag": type_tag}
    if parent is not None:
        body["parent_id"] = parent
    r = c.post("/api/spaces", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _names(nodes) -> set:
    return {n["name"] for n in nodes}


def test_empty_forest(client):
    assert client.get("/api/spaces/tree").json()["data"] == []


def test_create_nested_tree_shape(client):
    root = _create(client, "卧室", type_tag="room")
    wardrobe = _create(client, "衣柜", parent=root["id"], type_tag="wardrobe")
    drawer = _create(client, "上排左格", parent=wardrobe["id"], type_tag="drawer")
    desk = _create(client, "书桌", parent=root["id"], type_tag="desk")

    data = client.get(f"/api/spaces/tree?root_id={root['id']}").json()["data"]
    assert len(data) == 1
    assert data[0]["name"] == "卧室"
    assert _names(data[0]["children"]) == {"衣柜", "书桌"}
    assert _names(data[0]["children"][0]["children"]) == {"上排左格"}

    # full forest includes the root subtree
    forest = client.get("/api/spaces/tree").json()["data"]
    assert "卧室" in _names(forest)

    client.delete(f"/api/spaces/{root['id']}")


def test_move_reparents_and_cycles_rejected(client):
    a = _create(client, "A", type_tag="room")
    b = _create(client, "B", parent=a["id"])
    g = _create(client, "G", parent=b["id"])

    # move A under its own descendant -> cycle -> 400
    r = client.post(f"/api/spaces/{a['id']}/move", json={"parent_id": g["id"]})
    assert r.status_code == 400

    # move A under itself -> 400
    r = client.post(f"/api/spaces/{a['id']}/move", json={"parent_id": a["id"]})
    assert r.status_code == 400

    # move G to be a sibling of B (reparent to A)
    r = client.post(f"/api/spaces/{g['id']}/move", json={"parent_id": a["id"], "index": 0})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["parent_id"] == a["id"]
    assert r.json()["data"]["ord"] == 0

    # move into missing parent -> 404
    r = client.post(f"/api/spaces/{g['id']}/move", json={"parent_id": 999_999})
    assert r.status_code == 404

    client.delete(f"/api/spaces/{a['id']}")


def test_delete_cascade_vs_move_children(client):
    root = _create(client, "盒子", type_tag="box")
    child = _create(client, "夹层", parent=root["id"])
    _create(client, "内袋", parent=child["id"])

    # cascade removes everything below root
    r = client.delete(f"/api/spaces/{root['id']}?mode=cascade")
    assert r.status_code == 200
    assert client.get("/api/spaces/tree").json()["data"] == []

    # move_children promotes children up one level
    root2 = _create(client, "储物柜", type_tag="wardrobe")
    c1 = _create(client, "上层", parent=root2["id"])
    grand = _create(client, "左抽屉", parent=c1["id"])
    sibling = _create(client, "下层", parent=root2["id"])

    r = client.delete(f"/api/spaces/{c1['id']}?mode=move_children")
    assert r.status_code == 200
    # grand became a direct child of root2; c1 gone
    sub = client.get(f"/api/spaces/tree?root_id={root2['id']}").json()["data"][0]
    assert _names(sub["children"]) == {"左抽屉", "下层"}
    assert grand["id"] in {n["id"] for n in sub["children"]}

    client.delete(f"/api/spaces/{root2['id']}")
