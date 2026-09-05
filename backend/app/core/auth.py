from __future__ import annotations

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.db.engine import read
from app.domains.settings import service

_PUBLIC = {"/api/health", "/api/schema-version"}


def _authorized(request: Request) -> bool:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return False
    token = header[7:].strip()
    if not token:
        return False
    with read() as conn:
        return service.valid_token(conn, token)


async def auth_middleware(request: Request, call_next) -> Response:
    """Guard every /api route EXCEPT /api/health + /api/schema-version behind the
    optional LAN token. Read-only to settings; static/SPA paths pass through."""
    path = request.url.path
    if path.startswith("/api") and path not in _PUBLIC:
        with read() as conn:
            enabled = service.token_enabled(conn)
        if enabled and not _authorized(request):
            return JSONResponse(status_code=401, content={"error": "需要访问令牌"})
    return await call_next(request)