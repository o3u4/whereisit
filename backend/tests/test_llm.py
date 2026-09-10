import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_recognize_unconfigured_is_503(client):
    r = client.post("/api/llm/recognize", json={"text": "一个抽屉里有剪刀"})
    assert r.status_code == 503


from types import SimpleNamespace


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

    monkeypatch.setattr(svc, "available", lambda: True)
    monkeypatch.setattr(svc, "OpenAI", _FakeOpenAI)
    r = client.post("/api/llm/recognize", json={"text": "抽屉里一把剪刀"})
    assert r.status_code == 200, r.text
    nodes = r.json()["data"]["nodes"]
    assert nodes[0]["name"] == "抽屉"
    assert nodes[0]["items"][0]["name"] == "剪刀"