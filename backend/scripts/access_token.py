#!/usr/bin/env python
"""whereisit · dev-only helper to read (or rotate) the access token.

For LOCAL development/debugging only. It refuses to run unless WHEREISIT_DEBUG=1
is set, so a production deployment (which won't set that env) can never leak or
rotate the token through this path.

Usage (from backend/):
  WHEREISIT_DEBUG=1 python scripts/access_token.py            # show current token
  WHEREISIT_DEBUG=1 python scripts/access_token.py --replace   # rotate + show new
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))  # make `app` importable from any cwd

from app.core import config  # noqa: E402
from app.db.engine import connect  # noqa: E402
from app.domains.settings import service  # noqa: E402


def main() -> None:
    if os.environ.get("WHEREISIT_DEBUG") != "1":
        print("refusing: this is a dev/debug tool — set WHEREISIT_DEBUG=1 to run", file=sys.stderr)
        sys.exit(1)

    ap = argparse.ArgumentParser(description="whereisit dev access-token helper")
    ap.add_argument("--replace", action="store_true", help="rotate to a brand-new token")
    args = ap.parse_args()

    conn = connect()
    old = service.get_token(conn)

    if args.replace:
        token = service.rotate_token(conn)
        conn.commit()
        kind = "rotated to"
    else:
        token = old
        kind = "current"

    print(f"data dir     : {config.DATA_DIR}")
    print(f"protection   : {'on' if service.token_enabled(conn) else 'off'}")
    if token is None:
        print("access token : none set")
    else:
        print(f"access token : [{kind}] {token}")


if __name__ == "__main__":
    main()