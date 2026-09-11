from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _flush_llm(client):
    # teardown: clear LLM settings + secret so suites don't leak config
    from app.db.engine import tx

    yield
    with tx() as conn:
        conn.execute("DELETE FROM settings WHERE key IN ('llm_base_url', 'llm_model')")
        conn.execute("DELETE FROM secrets WHERE key = 'llm_api_key'")


def test_recognize_unconfigured_is_503(client):
    r = client.post("/api/llm/recognize", json={"text": "一个抽屉里有剪刀"})
    assert r.status_code == 503


def _resp():
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content='{"nodes":[{"name":"抽屉","items":[{"name":"剪刀","qty":1}]}]}'
                )
            )
        ]
    )


class _Completions:
    def create(self, **kwargs):
        return _resp()


class _Chat:
    completions = _Completions()


class _FakeOpenAI:
    def __init__(self, *a, **k):
        pass

    chat = _Chat()


def test_recognize_parses_tree(client, monkeypatch):
    import app.domains.llm.service as svc

    monkeypatch.setattr(svc, "OpenAI", _FakeOpenAI)
    # configure via settings (the operator's UI path)
    assert client.put(
        "/api/settings", json={"llm_base_url": "http://localhost:11434/v1", "llm_api_key": "k", "llm_model": "qwen2.5vl"}
    ).status_code == 200
    s = client.get("/api/settings").json()["data"]
    assert s["llm_configured"] is True
    assert s["llm_base_url"] == "http://localhost:11434/v1"
    assert "api_key" not in s  # never echoed

    r = client.post("/api/llm/recognize", json={"text": "抽屉里一把剪刀"})
    assert r.status_code == 200, r.text
    nodes = r.json()["data"]["nodes"]
    assert nodes[0]["name"] == "抽屉"
    assert nodes[0]["items"][0]["name"] == "剪刀"