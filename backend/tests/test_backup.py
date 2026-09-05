import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


_DEL_ORDER = ["attrs", "item_lots", "item_aliases", "item_defs", "categories", "spaces"]


def _snapshot(conn):
    return {
        t: {r["id"] for r in conn.execute(f"SELECT id FROM {t}").fetchall()}
        for t in _DEL_ORDER
    }


@pytest.fixture(autouse=True)
def _cleanup(client):
    """Backup tests write rows straight into the shared session DB; remove
    anything they created (defs/aliases/lots/attrs/categories/spaces) so the
    sibling suites (which assume a self-cleaned forest) stay green."""
    from app.db.engine import tx

    with tx() as conn:
        before = _snapshot(conn)
    yield
    with tx() as conn:
        after = _snapshot(conn)
        for t in _DEL_ORDER:
            for i in after[t] - before[t]:
                conn.execute(f"DELETE FROM {t} WHERE id = ?", (i,))


def _space(client: TestClient, name: str) -> dict:
    r = client.post("/api/spaces", json={"name": name, "type_tag": "generic"})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _register(client: TestClient, name: str, space_id: int, **kw) -> dict:
    r = client.post("/api/items/register", json={"name": name, "space_id": space_id, **kw})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_export_roundtrip_merge_idempotent(client):
    s = _space(client, "抽屉")
    _register(client, "HDMI 线", s["id"], category="电子配件", unit="条", qty=2, notes="备用")

    export = client.get("/api/export").json()["data"]
    data = export["data"]
    assert export["format"] == "whereisit-catalog"
    assert any(t["name"] == "抽屉" for t in data["spaces"])
    assert any(d["name"] == "HDMI 线" for d in data["defs"])
    assert any(l["space_id"] == s["id"] and l["notes"] == "备用" for l in data["lots"])

    # importing the same backup again must be idempotent (ids already exist)
    r1 = client.post("/api/import", json=export)
    assert r1.status_code == 200
    c1 = r1.json()["data"]
    assert c1["spaces_inserted"] <= 1  # the row we created may exist; re-import adds 0

    r2 = client.post("/api/import", json=export)
    c2 = r2.json()["data"]
    assert c2 == {"spaces_inserted": 0, "categories_inserted": 0, "defs_inserted": 0,
                  "aliases_inserted": 0, "lots_inserted": 0, "attrs_inserted": 0}

    # tree/item data unchanged after idempotent re-import
    assert any(n["name"] == "抽屉" for n in client.get("/api/spaces/tree").json()["data"])


def test_import_fresh_rows(client):
    payload = {
        "format": "whereisit-catalog",
        "version": 1,
        "exported_at": "2026-09-05T00:00:00+00:00",
        "data": {
            "spaces": [
                {"id": 9001, "parent_id": None, "name": "车库", "name_norm": "车库",
                 "ord": 0, "type_tag": "generic", "layout_json": None,
                 "created_at": "now", "updated_at": "now"},
            ],
            "categories": [],
            "defs": [
                {"id": 9002, "name": "工具", "name_norm": "工具", "category_id": None,
                 "unit": "件", "notes": None, "created_at": "now", "updated_at": "now"},
            ],
            "aliases": [],
            "lots": [
                {"id": 9003, "def_id": 9002, "space_id": 9001, "qty": 1, "status": "present",
                 "captured_at": "now", "notes": None, "created_at": "now", "updated_at": "now"},
            ],
            "attrs": [],
        },
    }
    r = client.post("/api/import?mode=merge", json=payload)
    assert r.status_code == 200
    counts = r.json()["data"]
    assert counts == {"spaces_inserted": 1, "categories_inserted": 0, "defs_inserted": 1,
                      "aliases_inserted": 0, "lots_inserted": 1, "attrs_inserted": 0}
    items = client.get("/api/items").json()["data"]
    assert any(it["name"] == "工具" for it in items)

    # wrong format rejected
    bad = dict(payload, format="nope")
    assert client.post("/api/import", json=bad).status_code == 400