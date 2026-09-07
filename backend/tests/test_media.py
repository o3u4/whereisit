import shutil

import pytest
from fastapi.testclient import TestClient

from app.core.config import MEDIA_DIR
from app.main import app

PNG_A = b"\x89PNG\r\n\x1a\n" + b"A" * 64
PNG_B = b"\x89PNG\r\n\x1a\n" + b"B" * 64


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
    shutil.rmtree(str(MEDIA_DIR), ignore_errors=True)


def _space(client, name="书房"):
    return client.post("/api/spaces", json={"name": name, "type_tag": "generic"}).json()["data"]


def _item(client, space_id):
    return client.post(
        "/api/items/register", json={"name": "HDMI 线", "space_id": space_id}
    ).json()["data"]["lot"]["lot_id"]


def _up(client, entity_type, entity_id, data=PNG_A, mime="image/png", name="a.png", headers=None):
    return client.put(
        f"/api/media?entity_type={entity_type}&entity_id={entity_id}",
        files={"file": (name, data, mime)},
        headers=headers or {},
    )


def test_put_get_overwrite_delete_lot(client):
    space = _space(client)
    lid = _item(client, space["id"])

    assert _up(client, "lot", lid).status_code == 201
    got = client.get(f"/api/media?entity_type=lot&entity_id={lid}")
    assert got.status_code == 200
    assert got.content == PNG_A

    # re-upload replaces (1:1) — one file still on disk
    assert _up(client, "lot", lid, data=PNG_B, name="b.png").status_code == 201
    assert client.get(f"/api/media?entity_type=lot&entity_id={lid}").content == PNG_B
    files = list((MEDIA_DIR / "1").iterdir())
    assert len(files) == 1

    assert client.delete(f"/api/media?entity_type=lot&entity_id={lid}").json()["data"]["removed"] is True
    assert client.get(f"/api/media?entity_type=lot&entity_id={lid}").status_code == 404


def test_space_image_roundtrip(client):
    space = _space(client)
    sid = int(space["id"])
    assert _up(client, "space", sid).status_code == 201
    assert client.get(f"/api/media?entity_type=space&entity_id={sid}").content == PNG_A
    assert client.delete(f"/api/media?entity_type=space&entity_id={sid}").status_code == 200
    assert client.get(f"/api/media?entity_type=space&entity_id={sid}").status_code == 404


def test_lot_delete_cleans_image(client):
    space = _space(client)
    lid = _item(client, space["id"])
    assert _up(client, "lot", lid).status_code == 201

    assert client.delete(f"/api/items/lots/{lid}").status_code == 200
    assert client.get(f"/api/media?entity_type=lot&entity_id={lid}").status_code == 404
    assert list(MEDIA_DIR.glob("1/*")) == []


def test_space_delete_cleans_space_and_lot_images(client):
    space = _space(client)
    child = client.post(
        "/api/spaces", json={"name": "子柜", "type_tag": "furniture", "parent_id": space["id"]}
    ).json()["data"]
    lid = _item(client, child["id"])
    assert _up(client, "space", int(space["id"])).status_code == 201
    assert _up(client, "space", int(child["id"])).status_code == 201
    assert _up(client, "lot", lid).status_code == 201

    assert client.delete(f"/api/spaces/{space['id']}").status_code == 200
    assert list(MEDIA_DIR.glob("1/*")) == []


def test_images_isolated_per_user(client):
    from app.domains.settings import service as settings_service

    # enable protection + create a second user
    root = client.post("/api/settings/token").json()["data"]["token"]
    h_root = {"Authorization": f"Bearer {root}"}
    alice = client.post("/api/admin/users", json={"username": "alice"}, headers=h_root).json()["data"]
    h_alice = {"Authorization": f"Bearer {alice['token']}"}

    a_space = client.post("/api/spaces", json={"name": "A库", "type_tag": "generic"}, headers=h_alice).json()["data"]

    # alice can read/write her own
    assert _up(client, "space", int(a_space["id"]), headers=h_alice).status_code == 201
    assert client.get(f"/api/media?entity_type=space&entity_id={a_space['id']}", headers=h_alice).status_code == 200
    assert client.get(f"/api/media?entity_type=space&entity_id={a_space['id']}", headers=h_root).status_code == 404
    assert client.delete(f"/api/media?entity_type=space&entity_id={a_space['id']}", headers=h_root).json()["data"]["removed"] is False
    # root cannot even upload into alice's space (ownership)
    assert _up(client, "space", int(a_space["id"]), headers=h_root).status_code == 404