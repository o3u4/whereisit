from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from app.core.config import DB_PATH

_PRAGMAS = (
    "PRAGMA journal_mode=WAL",
    "PRAGMA foreign_keys=ON",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA busy_timeout=5000",
    "PRAGMA cache_size=-16384",
)


def connect() -> sqlite3.Connection:
    """Open a connection in autocommit mode (isolation_level=None); callers
    drive explicit BEGIN/COMMIT via tx()/read()."""
    conn = sqlite3.connect(str(DB_PATH), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    for pragma in _PRAGMAS:
        conn.execute(pragma)
    return conn


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Write transaction: BEGIN IMMEDIATE grabs the write lock up front, which
    plays nicely with WAL + busy_timeout under a LAN's concurrent browsers.
    Commits on success, rolls back and re-raises on error, always closes."""
    conn = connect()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


@contextmanager
def read() -> Iterator[sqlite3.Connection]:
    """Read-only connection: no write lock, closed afterwards."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
