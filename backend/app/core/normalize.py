from __future__ import annotations

import unicodedata


def norm_text(s: str) -> str:
    """Canonical write/search key for names: NFKC folds full-width->half-width
    forms, casefold makes comparison case-insensitive, whitespace trimmed."""
    return unicodedata.normalize("NFKC", s or "").casefold().strip()
