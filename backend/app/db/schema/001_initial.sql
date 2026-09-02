-- ============================================================================
-- whereisit canonical schema v1 (canonical DDL, reused verbatim by future
-- mobile/desktop clients; treat every change as a new NNN_ migration file)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- spaces: the folder-path tree. A room, a wardrobe, a desk, a drawer, a box
-- are all the same node type. parent_id NULL = a root (a separate "domain").
-- ---------------------------------------------------------------------------
CREATE TABLE spaces (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES spaces(id),
    name        TEXT NOT NULL,
    name_norm   TEXT NOT NULL,
    ord         INTEGER NOT NULL DEFAULT 0,
    type_tag    TEXT NOT NULL DEFAULT 'generic',
    layout_json TEXT,                -- declarative spatial hints only, not geometry
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_spaces_parent_ord ON spaces(parent_id, ord);

-- ---------------------------------------------------------------------------
-- categories: small taxonomy tree (same adjacency shape as spaces).
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    parent_id  INTEGER REFERENCES categories(id),
    name       TEXT NOT NULL,
    name_norm  TEXT NOT NULL,
    ord        INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_categories_parent_ord ON categories(parent_id, ord);
CREATE INDEX idx_categories_name_norm ON categories(name_norm);

-- ---------------------------------------------------------------------------
-- item_defs: the "kind" (e.g. "HDMI cable"). Duplicate names allowed; a later
-- merge API dedupes. + item_aliases: typos / synonyms / EN-ZH aliases that
-- feed fuzzy search.
-- ---------------------------------------------------------------------------
CREATE TABLE item_defs (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    name_norm   TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    unit        TEXT,                -- 个 / 条 / 根 / 盒 ...
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_item_defs_name_norm ON item_defs(name_norm);

CREATE TABLE item_aliases (
    id        INTEGER PRIMARY KEY,
    def_id    INTEGER NOT NULL REFERENCES item_defs(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    name_norm TEXT NOT NULL
);
CREATE INDEX idx_item_aliases_def ON item_aliases(def_id);
CREATE INDEX idx_item_aliases_name_norm ON item_aliases(name_norm);

-- ---------------------------------------------------------------------------
-- item_lots: a "presence" of a kind in one space. Several lots of one def in
-- one space are allowed (separate pouches). Existence == SUM(qty) over lots
-- with status='present'. status: present | consumed | lent.
-- ---------------------------------------------------------------------------
CREATE TABLE item_lots (
    id          INTEGER PRIMARY KEY,
    def_id      INTEGER NOT NULL REFERENCES item_defs(id) ON DELETE CASCADE,
    space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
    status      TEXT NOT NULL DEFAULT 'present'
                CHECK (status IN ('present', 'consumed', 'lent')),
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_item_lots_def ON item_lots(def_id);
CREATE INDEX idx_item_lots_space_status ON item_lots(space_id, status);

-- ---------------------------------------------------------------------------
-- attrs: typed EAV for heterogeneous per-entity attributes. Queryable facts go
-- here (indexed, comparable, filterable); *documentary* structure goes in
-- spaces.layout_json. entity_type in (space, def, lot).
-- ---------------------------------------------------------------------------
CREATE TABLE attrs (
    id          INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('space', 'def', 'lot')),
    entity_id   INTEGER NOT NULL,
    attr_key    TEXT NOT NULL,       -- normalized on write
    value_type  TEXT NOT NULL CHECK (value_type IN ('text', 'int', 'real', 'bool', 'enum', 'date')),
    value_text  TEXT,                -- text / enum / date / json
    value_int   INTEGER,
    value_real  REAL,
    value_bool  INTEGER,
    uom         TEXT,
    UNIQUE (entity_type, entity_id, attr_key)
);
CREATE INDEX idx_attrs_entity ON attrs(entity_type, entity_id);
CREATE INDEX idx_attrs_key_int ON attrs(entity_type, attr_key, value_int);
CREATE INDEX idx_attrs_key_text ON attrs(entity_type, attr_key, value_text);

-- ---------------------------------------------------------------------------
-- settings: UI prefs / language / token hash.  secrets: encrypted blobs.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);

CREATE TABLE secrets (
    key         TEXT PRIMARY KEY,
    cipher_blob BLOB NOT NULL,
    meta_json   TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- FTS5 external-content indexes (trigram = CJK-friendly, no word boundaries).
-- One FTS index per searchable table; kept in sync by triggers so the .sql
-- stays self-contained and portable. Query layer decides short-term fallback.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE fts_spaces USING fts5(
    name, name_norm,
    content='spaces', content_rowid='id', tokenize='trigram'
);

CREATE TRIGGER spaces_ai AFTER INSERT ON spaces BEGIN
    INSERT INTO fts_spaces(rowid, name, name_norm)
        VALUES (new.id, new.name, new.name_norm);
END;
CREATE TRIGGER spaces_ad AFTER DELETE ON spaces BEGIN
    INSERT INTO fts_spaces(fts_spaces, rowid, name, name_norm)
        VALUES ('delete', old.id, old.name, old.name_norm);
END;
CREATE TRIGGER spaces_au AFTER UPDATE ON spaces BEGIN
    INSERT INTO fts_spaces(fts_spaces, rowid, name, name_norm)
        VALUES ('delete', old.id, old.name, old.name_norm);
    INSERT INTO fts_spaces(rowid, name, name_norm)
        VALUES (new.id, new.name, new.name_norm);
END;

CREATE VIRTUAL TABLE fts_item_defs USING fts5(
    name, name_norm,
    content='item_defs', content_rowid='id', tokenize='trigram'
);

CREATE TRIGGER item_defs_ai AFTER INSERT ON item_defs BEGIN
    INSERT INTO fts_item_defs(rowid, name, name_norm)
        VALUES (new.id, new.name, new.name_norm);
END;
CREATE TRIGGER item_defs_ad AFTER DELETE ON item_defs BEGIN
    INSERT INTO fts_item_defs(fts_item_defs, rowid, name, name_norm)
        VALUES ('delete', old.id, old.name, old.name_norm);
END;
CREATE TRIGGER item_defs_au AFTER UPDATE ON item_defs BEGIN
    INSERT INTO fts_item_defs(fts_item_defs, rowid, name, name_norm)
        VALUES ('delete', old.id, old.name, old.name_norm);
    INSERT INTO fts_item_defs(rowid, name, name_norm)
        VALUES (new.id, new.name, new.name_norm);
END;

CREATE VIRTUAL TABLE fts_item_aliases USING fts5(
    name, name_norm,
    content='item_aliases', content_rowid='id', tokenize='trigram'
);

CREATE TRIGGER item_aliases_ai AFTER INSERT ON item_aliases BEGIN
    INSERT INTO fts_item_aliases(rowid, name, name_norm)
        VALUES (new.id, new.name, new.name_norm);
END;
CREATE TRIGGER item_aliases_ad AFTER DELETE ON item_aliases BEGIN
    INSERT INTO fts_item_aliases(fts_item_aliases, rowid, name, name_norm)
        VALUES ('delete', old.id, old.name, old.name_norm);
END;
CREATE TRIGGER item_aliases_au AFTER UPDATE ON item_aliases BEGIN
    INSERT INTO fts_item_aliases(fts_item_aliases, rowid, name, name_norm)
        VALUES ('delete', old.id, old.name, old.name_norm);
    INSERT INTO fts_item_aliases(rowid, name, name_norm)
        VALUES (new.id, new.name, new.name_norm);
END;
