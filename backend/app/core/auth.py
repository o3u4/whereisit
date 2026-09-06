from __future__ import annotations

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.db.engine import read
from app.domains.settings import service

_PUBLIC = {
    "/api/health",
    "/api/schema-version",
    "/api/register-policy",  # gate needs the signup mode without a token
    "/api/register",  # self-signup (auto mode) is necessarily pre-auth
}
ROOT_USER_ID = 1


def _bearer(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return ""
    return header[7:].strip()


def get_current_user(request: Request) -> int:
    """Dependency: the authenticated user id for an /api request. auth_middleware
    guarantees request.state.user_id is set (protection ON → the token's owner,
    protection OFF → the root user, so single-user dev keeps working)."""
    return request.state.user_id


async def auth_middleware(request: Request, call_next) -> Response:
    """Guard /api routes behind the global token protection; resolve each
    request to a user id. Static/SPA paths pass through untouched.

    - protection ON: require a valid Bearer token, map it to its owner.
    - protection OFF: every /api request acts as the root user (dev default).
    """
    path = request.url.path
    if path.startswith("/api") and path not in _PUBLIC:
        with read() as conn:
            enabled = service.token_enabled(conn)
            uid = service.user_id_for_token(conn, _bearer(request)) if enabled else None
        if enabled:
            if uid is None:
                return JSONResponse(status_code=401, content={"error": "需要访问令牌"})
            request.state.user_id = uid
        else:
            request.state.user_id = ROOT_USER_ID
    else:
        # public /api + static paths still resolve to root for any Depends that runs
        request.state.user_id = ROOT_USER_ID
    return await call_next(request)