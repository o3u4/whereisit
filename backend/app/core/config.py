from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _default_data_dir() -> Path:
    return BACKEND_DIR / "data"


# WHEREISIT_DATA_DIR empty/unset → canonical backend/data. (An empty string must
# NOT fall through to Path("") which is Path(".") = cwd; check before Path().)
WHEREISIT_DATA_DIR = os.environ.get("WHEREISIT_DATA_DIR", "").strip()
DATA_DIR = Path(WHEREISIT_DATA_DIR).expanduser() if WHEREISIT_DATA_DIR else _default_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "whereisit.db"
SECRET_KEY_PATH = DATA_DIR / "secret.key"
MEDIA_DIR = DATA_DIR / "media"
SCHEMA_DIR = BACKEND_DIR / "app" / "db" / "schema"

PORT = int(os.environ.get("WHEREISIT_PORT", "8080"))
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"

# ---- LLM (multi-modal, OpenAI-compatible; used by structure/photo parsing) ----
# operator sets base_url + key + model (any OpenAI-compatible endpoint incl. a
# local ollama). Blank LLM_BASE_URL => the feature is off (endpoints return 503).
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").strip()
LLM_API_KEY = os.environ.get("LLM_API_KEY", "").strip()
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct").strip()
