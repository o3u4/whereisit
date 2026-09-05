from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _default_data_dir() -> Path:
    return BACKEND_DIR / "data"


DATA_DIR = Path(os.environ.get("WHEREISIT_DATA_DIR", "")).expanduser() or _default_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "whereisit.db"
SECRET_KEY_PATH = DATA_DIR / "secret.key"
SCHEMA_DIR = BACKEND_DIR / "app" / "db" / "schema"

PORT = int(os.environ.get("WHEREISIT_PORT", "8080"))
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
