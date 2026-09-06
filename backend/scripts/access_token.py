#!/usr/bin/env python
"""whereisit · dev-only helper to read, rotate, or create access tokens per user.

For LOCAL development/debugging only. It refuses to run unless WHEREISIT_DEBUG=1
is set, so a production deployment (which won't set that env) can never leak or
rotate tokens through this path.

Usage (from backend/):
  WHEREISIT_DEBUG=1 python scripts/access_token.py                        # root's token
  WHEREISIT_DEBUG=1 python scripts/access_token.py --user alice           # alice's token
  WHEREISIT_DEBUG=1 python scripts/access_token.py --user alice --replace # rotate alice
  WHEREISIT_DEBUG=1 python scripts/access_token.py --create-user alice    # new user + one-time token
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))  # make `app` importable from any cwd

from app.core import config  # noqa: E402
from app.core.errors import Conflict, NotFound  # noqa: E402
from app.db.engine import connect  # noqa: E402
from app.domains.users import service as users_service  # noqa: E402
from app.domains.settings import service as settings_service  # noqa: E402


def main() -> None:
    if os.environ.get("WHEREISIT_DEBUG") != "1":
        print("refusing: this is a dev/debug tool — set WHEREISIT_DEBUG=1 to run", file=sys.stderr)
        sys.exit(1)

    ap = argparse.ArgumentParser(description="whereisit dev access-token helper")
    ap.add_argument("--user", default="root", help="username (default: root)")
    ap.add_argument("--replace", action="store_true", help="rotate this user's token")
    ap.add_argument("--create-user", metavar="USERNAME", help="create a new user and print its one-time token")
    args = ap.parse_args()

    conn = connect()

    if args.create_user:
        try:
            created = users_service.create(conn, args.create_user)
            conn.commit()
        except (Conflict, NotFound) as e:
            print(f"error: {e.message}", file=sys.stderr)
            sys.exit(1)
        print(f"created user    : {created['username']} (id={created['id']})")
        print(f"one-time token  : {created['token']}")
        return

    user = users_service.get_by_username(conn, args.user)
    if user is None:
        print(f"error: unknown user '{args.user}' — create it with --create-user", file=sys.stderr)
        sys.exit(1)
    uid = user["id"]

    if args.replace:
        token = settings_service.rotate_token(conn, uid)
        conn.commit()
        kind = "rotated to"
    else:
        token = settings_service.get_token(conn, uid)
        kind = "current"

    enabled = settings_service.token_enabled(conn)
    print(f"data dir     : {config.DATA_DIR}")
    print(f"user         : {user['username']} (id={uid}, admin={bool(user['is_admin'])})")
    print(f"protection   : {'on' if enabled else 'off'}")
    if token is None:
        print(f"access token : none set for '{args.user}'")
    else:
        print(f"access token : [{kind}] {token}")


if __name__ == "__main__":
    main()