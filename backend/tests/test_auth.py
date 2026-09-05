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
        service.clear_token(conn)


def test_token_off_is_open(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/spaces/tree").status_code == 200


def test_token_gates_api(client):
    created = client.post("/api/settings/token")
    assert created.status_code == 201
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


def test_token_exempts_health(client):
    client.post("/api/settings/token")
    assert client.get("/api/health").status_code == 200