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


def _space(client: TestClient, name: str, parent: int | None = None) -> dict:
    body = {"name": name, "type_tag": "generic"}
    if parent is not None:
        body["parent_id"] = parent
    r = client.post("/api/spaces", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _reg(client: TestClient, name: str, space_id: int, **kw) -> dict:
    body = {"name": name, "space_id": space_id, **kw}
    r = client.post("/api/items/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _lots(client: TestClient) -> list[dict]:
    return client.get("/api/items").json()["data"]


def test_delete_present_lot_keeps_def_and_aliases(client):
    s = _space(client, "抽屉甲")
    d = _reg(client, "网线", s["id"], alias="utp", category="电子配件")
    lot_id = d["lot"]["lot_id"]
    def_id = d["lot"]["def_id"]

    r = client.delete(f"/api/items/lots/{lot_id}")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["removed_id"] == lot_id
    assert _lots(client) == []

    # same name re-registers a fresh presence onto the SAME def (category/alias reuse)
    again = _reg(client, "网线", s["id"], alias="utp", category="电子配件")
    assert again["lot"]["def_id"] == def_id
    assert again["lot"]["category"] == "电子配件"
    assert again["lot"]["alias"] == "utp"


def test_delete_keeps_def_level_attrs(client):
    s = _space(client, "桌面甲")
    d = _reg(client, "移动硬盘", s["id"], attrs=[{"key": "容量", "value": "1 TB"}])
    lot_id = d["lot"]["lot_id"]

    client.delete(f"/api/items/lots/{lot_id}")
    again = _reg(client, "移动硬盘", s["id"])["lot"]
    assert dict(again["attrs"]) == {"容量": "1 TB"}


def test_delete_lent_and_consumed_lots(client):
    s = _space(client, "抽屉乙")
    lent = _reg(client, "蓝牙耳机", s["id"], status="lent")
    cons = _reg(client, "创可贴", s["id"], status="consumed")
    assert client.delete(f"/api/items/lots/{lent['lot']['lot_id']}").status_code == 200
    assert client.delete(f"/api/items/lots/{cons['lot']['lot_id']}").status_code == 200
    assert _lots(client) == []


def test_delete_unknown_lot_404(client):
    r = client.delete("/api/items/lots/999_999")
    assert r.status_code == 404


def test_space_delete_reports_removed_lots_cascade(client):
    a = _space(client, "储物格甲")
    _reg(client, "螺丝", a["id"])
    _reg(client, "钉子", a["id"])
    r = client.delete(f"/api/spaces/{a['id']}?mode=cascade")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["removed_lots"] == 2
    assert a["id"] in data["removed_ids"]


def test_space_delete_move_children_counts_only_own_lots(client):
    root = _space(client, "柜甲")
    c1 = _space(client, "上层", parent=root["id"])
    grand = _space(client, "左抽屉", parent=c1["id"])
    _reg(client, "在自己里", c1["id"])
    _reg(client, "在孙子里", grand["id"])

    r = client.delete(f"/api/spaces/{c1['id']}?mode=move_children")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["removed_lots"] == 1  # c1's own lot only; grand's stays (promoted)
    assert c1["id"] in data["removed_ids"]
    # grand survived and still holds its item
    tree = client.get(f"/api/spaces/tree?root_id={root['id']}").json()["data"]
    assert tree[0]["children"][0]["id"] == grand["id"]
    names = [i["name"] for i in _lots(client)]
    assert "在孙子里" in names and "在自己里" not in names