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
        service.clear_token(conn, 1)                # protection off again
        # test_users runs last; wipe the shared DB back to an empty forest
        for t in ["attrs", "item_lots", "item_aliases", "item_defs", "categories", "spaces"]:
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM user_tokens WHERE user_id NOT IN (1)")
        conn.execute("DELETE FROM users WHERE id NOT IN (1)")


def _root_token(client) -> str:
    # anon = root while protection is off; creating the root token turns it on
    r = client.post("/api/settings/token")
    assert r.status_code == 200, r.text
    return r.json()["data"]["token"]


def _create_user(client, root_headers, username) -> tuple[dict, str]:
    r = client.post("/api/admin/users", json={"username": username}, headers=root_headers)
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    return d, d["token"]


def test_settings_reports_username_and_admin(client):
    d = client.get("/api/settings").json()["data"]
    assert d["username"] == "root"
    assert d["is_admin"] is True


def test_root_lists_users(client):
    root = _root_token(client)
    h = {"Authorization": f"Bearer {root}"}
    users = client.get("/api/admin/users", headers=h).json()["data"]["users"]
    assert {"username": "root", "is_admin": True} in [
        {"username": u["username"], "is_admin": u["is_admin"]} for u in users
    ]


def test_non_admin_cannot_manage_users(client):
    root = _root_token(client)
    h_root = {"Authorization": f"Bearer {root}"}
    _, alice_token = _create_user(client, h_root, "alice")
    h_alice = {"Authorization": f"Bearer {alice_token}"}

    assert client.post("/api/admin/users", json={"username": "bob"}, headers=h_alice).status_code == 403
    assert client.get("/api/admin/users", headers=h_alice).status_code == 403


def test_per_user_data_isolation(client):
    root = _root_token(client)
    h_root = {"Authorization": f"Bearer {root}"}

    # root makes a space + item
    space = client.post("/api/spaces", json={"name": "书房", "type_tag": "generic"}, headers=h_root).json()["data"]
    root_space_id = space["id"]
    assert client.post(
        "/api/items/register", json={"name": "HDMI 线", "space_id": root_space_id}, headers=h_root
    ).status_code == 201

    _, alice_token = _create_user(client, h_root, "alice")
    h_alice = {"Authorization": f"Bearer {alice_token}"}

    # alice sees none of root's data, and can't touch root's rows
    assert client.get("/api/spaces/tree", headers=h_alice).json()["data"] == []
    assert client.patch(f"/api/spaces/{root_space_id}", json={"name": "改"}, headers=h_alice).status_code == 404
    assert client.get("/api/search", params={"q": "HDMI", "mode": "fuzzy"}, headers=h_alice).json()["data"]["items"] == []

    # alice builds her own world
    alice_space = client.post("/api/spaces", json={"name": "工位", "type_tag": "generic"}, headers=h_alice).json()["data"]
    assert client.post(
        "/api/items/register", json={"name": "橡皮", "space_id": alice_space["id"]}, headers=h_alice
    ).status_code == 201

    # root sees only root's data
    root_names = [n["name"] for n in client.get("/api/spaces/tree", headers=h_root).json()["data"]]
    assert root_names == ["书房"]
    root_items = [it["name"] for it in client.get("/api/items", headers=h_root).json()["data"]]
    assert "橡皮" not in root_items and any(n == "HDMI 线" for n in root_items)


def test_same_def_name_is_isolated_per_user(client):
    """Two users may each have their own 'HDMI 线' without colliding."""
    root = _root_token(client)
    h_root = {"Authorization": f"Bearer {root}"}
    rs = client.post("/api/spaces", json={"name": "书房", "type_tag": "generic"}, headers=h_root).json()["data"]

    _, alice_token = _create_user(client, h_root, "alice")
    h_alice = {"Authorization": f"Bearer {alice_token}"}
    as_ = client.post("/api/spaces", json={"name": "工位", "type_tag": "generic"}, headers=h_alice).json()["data"]

    client.post("/api/items/register", json={"name": "HDMI 线", "space_id": rs["id"]}, headers=h_root)
    client.post("/api/items/register", json={"name": "HDMI 线", "space_id": as_["id"]}, headers=h_alice)

    assert len(client.get("/api/items", headers=h_root).json()["data"]) == 1
    assert len(client.get("/api/items", headers=h_alice).json()["data"]) == 1


def test_cross_user_merge_is_404(client):
    root = _root_token(client)
    h_root = {"Authorization": f"Bearer {root}"}
    rs = client.post("/api/spaces", json={"name": "书房", "type_tag": "generic"}, headers=h_root).json()["data"]
    client.post("/api/items/register", json={"name": "HDMI 线", "space_id": rs["id"]}, headers=h_root)
    root_def_id = client.get("/api/items", headers=h_root).json()["data"][0]["def_id"]

    _, alice_token = _create_user(client, h_root, "alice")
    h_alice = {"Authorization": f"Bearer {alice_token}"}
    as_ = client.post("/api/spaces", json={"name": "工位", "type_tag": "generic"}, headers=h_alice).json()["data"]
    client.post("/api/items/register", json={"name": "铅笔", "space_id": as_["id"]}, headers=h_alice)
    alice_def_id = client.get("/api/items", headers=h_alice).json()["data"][0]["def_id"]

    # alice cannot merge root's def into hers
    r = client.post(f"/api/items/defs/{alice_def_id}/merge", json={"from_id": root_def_id}, headers=h_alice)
    assert r.status_code == 404


def test_backup_is_scoped_to_user(client):
    root = _root_token(client)
    h_root = {"Authorization": f"Bearer {root}"}
    rs = client.post("/api/spaces", json={"name": "书房", "type_tag": "generic"}, headers=h_root).json()["data"]
    client.post("/api/items/register", json={"name": "HDMI 线", "space_id": rs["id"]}, headers=h_root)

    _, alice_token = _create_user(client, h_root, "alice")
    h_alice = {"Authorization": f"Bearer {alice_token}"}

    root_export = client.get("/api/export", headers=h_root).json()["data"]
    alice_export = client.get("/api/export", headers=h_alice).json()["data"]
    assert any(s["name"] == "书房" for s in root_export["data"]["spaces"])
    assert alice_export["data"]["spaces"] == []
    # owner_id never leaks into exports
    assert all("owner_id" not in row for rows in root_export["data"].values() for row in rows)


def test_delete_user_guards_and_removes_data(client):
    root = _root_token(client)
    h_root = {"Authorization": f"Bearer {root}"}

    _, alice_token = _create_user(client, h_root, "alice")
    h_alice = {"Authorization": f"Bearer {alice_token}"}
    as_ = client.post("/api/spaces", json={"name": "工位", "type_tag": "generic"}, headers=h_alice).json()["data"]
    client.post("/api/items/register", json={"name": "橡皮", "space_id": as_["id"]}, headers=h_alice)

    users = client.get("/api/admin/users", headers=h_root).json()["data"]["users"]
    alice_id = next(u["id"] for u in users if u["username"] == "alice")

    # cannot delete root, cannot revoke root's token into a broken state either
    assert client.delete("/api/admin/users/1", headers=h_root).status_code == 400

    # delete alice → her data vanishes and her token is dead (user removed → CASCADE)
    assert client.delete(f"/api/admin/users/{alice_id}", headers=h_root).status_code == 200
    assert client.get("/api/spaces/tree", headers=h_alice).status_code == 401
    still = client.get("/api/admin/users", headers=h_root).json()["data"]["users"]
    assert "alice" not in [u["username"] for u in still]