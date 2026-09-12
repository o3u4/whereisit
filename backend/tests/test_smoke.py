from fastapi.testclient import TestClient

from app.db import migrations
from app.main import app


def test_health_and_migrations():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        body = health.json()
        assert body["ok"] is True
        assert body["schema_version"] == 4


def test_schema_tables_created():
    assert migrations.current_version() == 4
    # Triggering current_version opens the same test DB the migration created.
