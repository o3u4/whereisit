"""CJK search behavior spike (trigram tokenizer):
>=3-char substrings are matched by FTS5; <=2-char terms produce no trigram and
need an app-level LIKE/prefix fallback (documented requirement, M3)."""

from app.db import migrations
from app.db.engine import tx
from app.core.normalize import norm_text

migrations.apply()


def _seed() -> None:
    with tx() as db:
        db.execute(
            "INSERT INTO item_defs (name, name_norm, unit) VALUES (?, ?, ?)",
            ("HDMI高清线", norm_text("HDMI高清线"), "条"),
        )
        db.execute(
            "INSERT INTO item_defs (name, name_norm, unit) VALUES (?, ?, ?)",
            ("备用钥匙", norm_text("备用钥匙"), "把"),
        )


def test_trigram_matches_three_char_cjk_substring():
    _seed()
    with tx() as db:
        hit = db.execute(
            "SELECT d.id FROM fts_item_defs f "
            "JOIN item_defs d ON d.id = f.rowid "
            "WHERE f.name_norm MATCH ?",
            (norm_text("高清线"),),
        ).fetchall()
        assert len(hit) == 1


def test_trigram_does_not_match_two_char_cjk():
    # 2-char terms have no trigrams -> expected empty; the app falls back to LIKE.
    _seed()
    with tx() as db:
        hit = db.execute(
            "SELECT d.id FROM fts_item_defs f "
            "JOIN item_defs d ON d.id = f.rowid "
            "WHERE f.name_norm MATCH ?",
            (norm_text("钥匙"),),
        ).fetchall()
        assert len(hit) == 0
