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
    # leave the shared test DB with token off + zh so sibling test files are unaffected
    from app.db.engine import tx
    from app.domains.settings import service

    with tx() as conn:
        service.clear_token(conn)
        service.put(conn, lang="zh")


def test_settings_defaults(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["lang"] == "zh"
    assert d["token_enabled"] is False
    assert d["lan_url"]  # "host:port"


def test_set_lang_roundtrip(client):
    r = client.put("/api/settings", json={"lang": "en"})
    assert r.status_code == 200
    assert r.json()["data"]["lang"] == "en"
    assert client.get("/api/settings").json()["data"]["lang"] == "en"


def test_invalid_lang_rejected(client):
    r = client.put("/api/settings", json={"lang": "fr"})
    assert r.status_code == 400


def test_allow_token_enabled_without_token_fails(client):
    r = client.put("/api/settings", json={"token_enabled": True})
    assert r.status_code == 400
    assert client.get("/api/settings").json()["data"]["token_enabled"] is False