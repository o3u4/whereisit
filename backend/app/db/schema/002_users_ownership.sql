-- ============================================================================
-- whereisit schema v2: multi-user + per-user data ownership.
-- Adds a users table, per-user encrypted tokens, and an owner_id on every
-- business table so each user only sees/creates/mutates their own rows.
-- Existing rows + the legacy single access_token are backfilled to the root
-- admin user (id=1). SQLite can't attach a FK to an ADD COLUMN with a NOT NULL
-- default, so owner_id has no FK and ownership is enforced in the app layer.
-- ============================================================================

CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_tokens (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cipher_blob BLOB NOT NULL,
    meta_json   TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE spaces       ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories   ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item_defs    ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item_aliases ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item_lots    ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attrs        ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_spaces_owner       ON spaces(owner_id);
CREATE INDEX idx_categories_owner   ON categories(owner_id);
CREATE INDEX idx_item_defs_owner    ON item_defs(owner_id);
CREATE INDEX idx_item_aliases_owner ON item_aliases(owner_id);
CREATE INDEX idx_item_lots_owner    ON item_lots(owner_id);
CREATE INDEX idx_attrs_owner        ON attrs(owner_id);

-- seed the root admin; every legacy row becomes his
INSERT INTO users (id, username, is_admin) VALUES (1, 'root', 1);

UPDATE spaces       SET owner_id = 1 WHERE owner_id = 0;
UPDATE categories   SET owner_id = 1 WHERE owner_id = 0;
UPDATE item_defs    SET owner_id = 1 WHERE owner_id = 0;
UPDATE item_aliases SET owner_id = 1 WHERE owner_id = 0;
UPDATE item_lots    SET owner_id = 1 WHERE owner_id = 0;
UPDATE attrs        SET owner_id = 1 WHERE owner_id = 0;

-- move the legacy single token to the root user
INSERT INTO user_tokens (user_id, cipher_blob)
    SELECT 1, cipher_blob FROM secrets WHERE key = 'access_token';
DELETE FROM secrets WHERE key = 'access_token';