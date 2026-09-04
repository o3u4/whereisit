import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _cleanup_new_spaces(client):
    """Session DB is shared; delete any roots this test created so test_spaces
    (which asserts on an empty/self-cleaned forest) stays green."""
    before = {n["id"] for n in client.get("/api/spaces/tree").json()["data"]}
    yield
    for n in client.get("/api/spaces/tree").json()["data"]:
        if n["id"] not in before:
            client.delete(f"/api/spaces/{n['id']}?mode=cascade")


def _space(client: TestClient, name: str, type_tag="generic") -> dict:
    r = client.post("/api/spaces", json={"name": name, "type_tag": type_tag})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _register(client: TestClient, name: str, space_id: int, **kw) -> dict:
    body = {"name": name, "space_id": space_id, **kw}
    r = client.post("/api/items/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_register_new_def_persists_lot(client):
    s = _space(client, "左抽屉")
    data = _register(
        client,
        "HDMI 线",
        s["id"],
        alias="hdmi,高清线,视频线",
        category="电子配件",
        unit="条",
        qty=3,
        attrs=[{"key": "长度", "value": "2 m"}, {"key": "标记", "value": "客厅备用"}],
    )
    assert data["merged"] is False
    lot = data["lot"]
    assert lot["name"] == "HDMI 线"
    assert lot["category"] == "电子配件"
    assert lot["alias"] == "hdmi"
    assert lot["unit"] == "条"
    assert lot["qty"] == 3
    assert lot["status"] == "present"
    assert lot["space_id"] == s["id"]
    assert {"长度": "2 m", "标记": "客厅备用"}.items() <= dict(lot["attrs"]).items()

    rows = client.get("/api/items").json()["data"]
    assert len(rows) == 1
    assert rows[0]["name"] == "HDMI 线"


def test_register_merges_same_name_same_place_present(client):
    s = _space(client, "抽屉乙")
    lot_a = _register(client, "胶带", s["id"], qty=3)["lot"]
    merged = _register(client, "胶带", s["id"], qty=2)
    assert merged["merged"] is True
    assert merged["lot"]["lot_id"] == lot_a["lot_id"]
    assert merged["lot"]["qty"] == 5
    rows = [r for r in client.get("/api/items").json()["data"] if r["name"] == "胶带"]
    assert len(rows) == 1


def test_register_same_def_different_space_new_lot(client):
    s1 = _space(client, "格一")
    s2 = _space(client, "格二")
    lot_a = _register(client, "充电器", s1["id"], qty=1)["lot"]
    lot_b = _register(client, "充电器", s2["id"], qty=2)["lot"]
    assert lot_b["lot_id"] != lot_a["lot_id"]
    assert lot_b["qty"] == 2
    rows = [r for r in client.get("/api/items").json()["data"] if r["name"] == "充电器"]
    assert len(rows) == 2


def test_register_lent_same_space_is_separate(client):
    s = _space(client, "抽屉丙")
    _register(client, "充电宝", s["id"], qty=3)  # present
    _register(client, "充电宝", s["id"], qty=2)  # present -> merges to 5
    lent = _register(client, "充电宝", s["id"], qty=1, status="lent")["lot"]
    assert lent["status"] == "lent"
    rows = [r for r in client.get("/api/items").json()["data"] if r["name"] == "充电宝"]
    assert len(rows) == 2
    present = [r for r in rows if r["status"] == "present"]
    assert len(present) == 1 and present[0]["qty"] == 5


def test_register_qty_zero_400_and_missing_space_404(client):
    s = _space(client, "抽屉丁")
    r = client.post("/api/items/register", json={"name": "订书机", "space_id": s["id"], "qty": 0})
    assert r.status_code == 400
    r = client.post("/api/items/register", json={"name": "订书机", "space_id": 999_999})
    assert r.status_code == 404


def test_category_label_normalized_reuse(client):
    s = _space(client, "桌面甲")
    a = _register(client, "回形针", s["id"], category=" 电子配件 ")["lot"]
    b = _register(client, "别针", s["id"], category="电子配件")["lot"]
    assert a["category"] == "电子配件"
    assert b["category"] == "电子配件"


def test_alias_split_skips_def_name(client):
    s = _space(client, "工具柜一层")
    lot = _register(client, "螺丝刀套装", s["id"], alias="螺丝刀, 套装 | 螺丝刀套装")["lot"]
    # def-name alias "螺丝刀套装" dropped; first stored alias is "螺丝刀"
    assert lot["alias"] == "螺丝刀"


def test_attrs_only_written_on_def_create(client):
    s1 = _space(client, "桌面乙")
    s2 = _space(client, "抽屉戊")
    first = _register(client, "移动硬盘", s1["id"], attrs=[{"key": "容量", "value": "1 TB"}])["lot"]
    assert dict(first["attrs"]) == {"容量": "1 TB"}
    second = _register(client, "移动硬盘", s2["id"], attrs=[{"key": "接口", "value": "C 口"}])["lot"]
    # existing def wins -> original attr kept, new one ignored
    assert dict(second["attrs"]) == {"容量": "1 TB"}


def test_patch_absolute_qty_and_status_in_place(client):
    s = _space(client, "床头柜层")
    lot = _register(client, "墨水", s["id"], qty=3)["lot"]
    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={"qty": 5})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["lot"]["qty"] == 5

    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={"status": "lent"})
    assert r.json()["data"]["lot"]["status"] == "lent"
    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={"qty": 2, "status": "present"})
    assert r.json()["data"]["lot"]["qty"] == 2
    assert r.json()["data"]["lot"]["status"] == "present"


def test_patch_relocate_merges_into_present_at_target(client):
    s1 = _space(client, "客厅柜")
    s2 = _space(client, "书房柜")
    lot_a = _register(client, "数据线", s1["id"], qty=2)["lot"]
    lot_b = _register(client, "数据线", s2["id"], qty=3)["lot"]

    r = client.patch(f"/api/items/lots/{lot_b['lot_id']}", json={"space_id": s1["id"]})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["merged"] is True
    assert data["removed_id"] == lot_b["lot_id"]
    assert data["lot"]["lot_id"] == lot_a["lot_id"]
    assert data["lot"]["qty"] == 5
    rows = [r for r in client.get("/api/items").json()["data"] if r["name"] == "数据线"]
    assert len(rows) == 1


def test_patch_relocate_into_empty_moves(client):
    s1 = _space(client, "玄关盒")
    s2 = _space(client, "储物格")
    lot = _register(client, "伞", s1["id"], qty=1)["lot"]
    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={"space_id": s2["id"]})
    data = r.json()["data"]
    assert data["merged"] is False
    assert data["lot"]["space_id"] == s2["id"]


def test_patch_relocate_lent_does_not_merge(client):
    s1 = _space(client, "柜上")
    s2 = _space(client, "柜下")
    _register(client, "耳机", s1["id"], qty=1)
    _register(client, "耳机", s2["id"], qty=2)  # present at target
    lent = _register(client, "耳机", s1["id"], qty=1, status="lent")["lot"]

    r = client.patch(f"/api/items/lots/{lent['lot_id']}", json={"space_id": s2["id"]})
    data = r.json()["data"]
    assert data["merged"] is False
    assert data["lot"]["space_id"] == s2["id"]
    assert data["lot"]["status"] == "lent"
    rows = [r for r in client.get("/api/items").json()["data"] if r["name"] == "耳机"]
    assert len(rows) == 3


def test_patch_errors(client):
    s = _space(client, "空抽屉")
    lot = _register(client, "便签", s["id"], qty=1)["lot"]

    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={})
    assert r.status_code == 400

    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={"qty": 0})
    assert r.status_code == 400

    r = client.patch("/api/items/lots/999_999", json={"qty": 2})
    assert r.status_code == 404

    r = client.patch(f"/api/items/lots/{lot['lot_id']}", json={"space_id": 999_999})
    assert r.status_code == 404


def test_register_and_patch_notes(client):
    s = _space(client, "柜戊")
    d = _register(client, "便签乙", s["id"], notes="给小明")
    assert d["lot"]["notes"] == "给小明"
    r = client.patch(f"/api/items/lots/{d['lot']['lot_id']}", json={"notes": "换备注了"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["lot"]["notes"] == "换备注了"


def test_register_no_merge_creates_separate_lot(client):
    """Undo-delete restore: no_merge must rebuild an independent lot even when a
    same-def present lot already sits in the target space (no absorbing)."""
    s = _space(client, "抽屉壬")
    first = _register(client, "裁纸刀", s["id"], qty=1)
    assert first["merged"] is False
    second = _register(client, "裁纸刀", s["id"], qty=2, no_merge=True)
    assert second["merged"] is False
    assert second["lot"]["lot_id"] != first["lot"]["lot_id"]
    lots = [r for r in client.get("/api/items").json()["data"] if r["name"] == "裁纸刀"]
    assert len(lots) == 2
    assert {r["qty"] for r in lots} == {1, 2}


def test_legacy_note_attr_folds_into_lot_notes(client):
    s = _space(client, "抽屉癸")
    d = _register(client, "探针", s["id"], attrs=[{"key": "备注", "value": "小心轻放"}])
    lot = d["lot"]
    assert lot["notes"] == "小心轻放"
    assert "备注" not in [a[0] for a in lot["attrs"]]


def test_def_attr_upsert_appends_then_deletes(client):
    s = _space(client, "盒丙")
    d = _register(client, "标签机", s["id"], qty=1)
    def_id = d["lot"]["def_id"]
    r = client.put(f"/api/items/defs/{def_id}/attrs", json={"key": "耗材", "value": "纸卷"})
    assert r.status_code == 200, r.text
    lot = [r for r in client.get("/api/items").json()["data"] if r["def_id"] == def_id][0]
    assert dict(lot["attrs"])["耗材"] == "纸卷"

    # update keeps slot; adding a new key appends after existing ones
    client.put(f"/api/items/defs/{def_id}/attrs", json={"key": "耗材", "value": "热敏纸"})
    second = client.put(f"/api/items/defs/{def_id}/attrs", json={"key": "供电", "value": "电池"})
    assert second.status_code == 200, second.text
    lot = [r for r in client.get("/api/items").json()["data"] if r["def_id"] == def_id][0]
    keys = [a[0] for a in lot["attrs"]]
    assert keys == ["耗材", "供电"]
    assert dict(lot["attrs"])["耗材"] == "热敏纸"

    r = client.delete(f"/api/items/defs/{def_id}/attrs", params={"key": "供电"})
    assert r.status_code == 200, r.text
    lot = [r for r in client.get("/api/items").json()["data"] if r["def_id"] == def_id][0]
    assert [a[0] for a in lot["attrs"]] == ["耗材"]
