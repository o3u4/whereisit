import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _cleanup_new_spaces(client):
    """Deletes any roots this test created so the shared session DB stays clean."""
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


def _search(client: TestClient, q: str, **kw) -> dict:
    r = client.get("/api/search", params={"q": q, **kw})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _lot_names(data: dict) -> list[str]:
    return [it["name"] for it in data["items"]]


def test_fuzzy_trigram_three_char_and_alias(client):
    s = _space(client, "柜甲")
    _reg(client, "螺丝刀套装", s["id"], alias="螺丝刀, screwdriver")
    # def name >=3 chars matches via FTS
    data = _search(client, "螺丝刀套装")
    assert "螺丝刀套装" in _lot_names(data)
    # alias-only match (3-char) via fts_item_aliases
    data = _search(client, "screwdriver")
    assert "螺丝刀套装" in _lot_names(data)


def test_fuzzy_short_word_like_fallback(client):
    s = _space(client, "柜乙")
    _reg(client, "备用钥匙", s["id"], alias="钥匙, key")
    data = _search(client, "钥匙")
    assert "备用钥匙" in _lot_names(data)


def test_fuzzy_multiterm_and(client):
    s = _space(client, "柜丙")
    _reg(client, "HDMI 线", s["id"], alias="高清线")
    data = _search(client, "hdmi 线")
    assert "HDMI 线" in _lot_names(data)
    # a term that isn't present should kill the row (AND semantics)
    data = _search(client, "hdmi 不存在")
    assert "HDMI 线" not in _lot_names(data)


def test_fuzzy_injection_neutralised(client):
    s = _space(client, "柜丁")
    _reg(client, "胶带", s["id"])
    data = _search(client, 'abc"x')  # must not error / must not widen
    assert data["items"] == []


def test_exact_normalizes_case_and_nfkc(client):
    s = _space(client, "柜戊")
    _reg(client, "HDMI 线", s["id"])
    data = _search(client, "ｈｄｍｉ  线", mode="exact")
    assert "HDMI 线" in _lot_names(data)


def test_exact_matches_space_name(client):
    r = _space(client, "客厅甲")
    data = _search(client, "客厅甲", mode="exact")
    assert any(sp["id"] == r["id"] for sp in data["spaces"])


def test_category_by_label(client):
    s = _space(client, "柜己")
    _reg(client, "扳手", s["id"], category="工具")
    _reg(client, "创可贴", s["id"], category="日用")
    data = _search(client, "工具", mode="category")
    names = _lot_names(data)
    assert "扳手" in names and "创可贴" not in names


def test_existence_scoped(client):
    a = _space(client, "A层")
    child = _space(client, "A子格", parent=a["id"])
    b = _space(client, "B层")
    _reg(client, "伞", child["id"])
    # inside scope -> present
    data = _search(client, "伞", mode="existence", scope_space_id=a["id"])
    assert _lot_names(data) == ["伞"]
    # outside scope -> absent
    data = _search(client, "伞", mode="existence", scope_space_id=b["id"])
    assert data["items"] == []


def test_existence_no_scope_finds_anywhere(client):
    s = _space(client, "柜庚")
    _reg(client, "螺丝", s["id"])
    data = _search(client, "螺丝", mode="existence")
    assert "螺丝" in _lot_names(data)


def test_empty_results_shape(client):
    s = _space(client, "柜辛")
    _reg(client, "别针", s["id"])
    data = _search(client, "zzz不存在的词")
    assert data == {"mode": "fuzzy", "items": [], "spaces": []}


def test_bad_mode_and_misused_params(client):
    r = client.get("/api/search", params={"q": "x", "mode": "bogus"})
    assert r.status_code == 400
    r = client.get("/api/search", params={"q": "x", "mode": "fuzzy", "scope_space_id": 1})
    assert r.status_code == 400
    r = client.get("/api/search", params={"q": "x", "mode": "fuzzy", "category_id": 1})
    assert r.status_code == 400