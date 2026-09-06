import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset(client):
    yield
    from app.db.engine import tx
    from app.domains.settings import service

    with tx() as conn:
        service.clear_token(conn, 1)  # leave shared DB: protection off, root token gone


def test_token_off_is_open(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/spaces/tree").status_code == 200


def test_token_gates_api(client):
    created = client.post("/api/settings/token")
    assert created.status_code == 200
    token = created.json()["data"]["token"]

    # token enabled → every /api now guarded (settings GET included)
    assert client.get("/api/spaces/tree").status_code == 401
    assert client.get("/api/settings").status_code == 401

    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/spaces/tree", headers=headers).status_code == 200
    assert client.get("/api/settings", headers=headers).status_code == 200

    assert client.get(
        "/api/spaces/tree", headers={"Authorization": "Bearer nope"}
    ).status_code == 401


def test_token_stable_and_retrievable(client):
    # first POST creates + enables; once enabled, repeats need the token
    a = client.post("/api/settings/token").json()["data"]["token"]
    h = {"Authorization": f"Bearer {a}"}
    b = client.post("/api/settings/token", headers=h).json()["data"]["token"]
    assert a == b  # stable: no rotation on repeat

    # an authorized session can re-fetch it for re-show / re-download
    got = client.get("/api/settings/token", headers=h)
    assert got.status_code == 200
    assert got.json()["data"]["token"] == a

    # explicit replace hands out a new one, killing the old
    r = client.post("/api/settings/token/replace", headers=h)
    assert r.status_code == 200
    new = r.json()["data"]["token"]
    assert new != a
    assert client.get("/api/spaces/tree", headers=h).status_code == 401
    assert client.get("/api/spaces/tree", headers={"Authorization": f"Bearer {new}"}).status_code == 200

    # revoke, then protection is off and there's nothing to fetch (404)
    client.delete("/api/settings/token", headers={"Authorization": f"Bearer {new}"})
    assert client.get("/api/settings/token").status_code == 404
    assert client.get("/api/spaces/tree").status_code == 200  # open again


def test_token_exempts_health(client):
    client.post("/api/settings/token")
    assert client.get("/api/health").status_code == 200