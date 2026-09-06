#!/usr/bin/env python
"""whereisit · LAN launch helper.

Starts the FastAPI backend bound to 0.0.0.0 so any LAN device (phone, another
PC) can reach it on http://<this-pc-IP>:<port>. The built SPA and the /api
backends live on the SAME port (single-port production hosting).

Data lives in the default backend/data/ dir. A frontend build must exist at
frontend/dist/ so LAN visitors get the current UI (use --build to make it).

Usage:
  python run_lan.py               # port 8080 (or $WHEREISIT_PORT), no reload
  python run_lan.py --port 9000
  python run_lan.py --reload      # auto-reload on code changes (dev)
  python run_lan.py --build       # rebuild the frontend before serving
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent
os.chdir(_BACKEND)          # make `app` importable + default data dir resolve
sys.path.insert(0, str(_BACKEND))

import uvicorn  # noqa: E402

from app.core import config  # noqa: E402


def _lan_ip() -> str | None:
    """Best-effort primary LAN IP (UDP connect picks the egress interface without sending)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def _dist_present() -> bool:
    return (config.FRONTEND_DIST / "index.html").exists()


def main() -> None:
    ap = argparse.ArgumentParser(description="whereisit LAN server")
    ap.add_argument("--port", type=int, default=None, help=f"default {config.PORT}")
    ap.add_argument("--reload", action="store_true", help="auto-reload on code changes")
    ap.add_argument("--build", action="store_true", help="rebuild frontend/dist before serving")
    args = ap.parse_args()

    port = args.port or config.PORT

    if args.build:
        frontend = config.FRONTEND_DIST.parent
        print(f"building frontend in {frontend} ...")
        subprocess.run(["npm", "run", "build"], cwd=frontend, check=True)

    print(f"whereisit data dir : {config.DATA_DIR}")
    print(f"  local access     : http://localhost:{port}")
    ip = _lan_ip()
    if ip:
        print(f"  LAN access       : http://{ip}:{port}")
    if not _dist_present():
        print("WARNING: no frontend build found — run `python run_lan.py --build` first.")
    if not (config.DATA_DIR / "whereisit.db").exists():
        print(f"NOTE: {config.DATA_DIR}/whereisit.db does not exist — a fresh empty DB will be created.")

    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=args.reload)


if __name__ == "__main__":
    main()