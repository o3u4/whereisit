from __future__ import annotations

from typing import Any


def ok(data: Any) -> dict:
    """Stable versioned envelope for every collection/entity endpoint."""
    return {"v": 1, "data": data}
