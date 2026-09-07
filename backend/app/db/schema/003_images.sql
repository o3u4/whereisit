-- ============================================================================
-- whereisit schema v3: per-user preview images (1:1 per entity, on-disk files).
-- One image per (owner, entity_type, entity_id); re-uploading replaces it. The
-- bytes live in DATA_DIR/media/<owner_id>/ and file_path stores the filename;
-- ownership mirrors the other business tables (app-layer enforcement, no FK).
-- ============================================================================

CREATE TABLE images (
    id          INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL DEFAULT 0,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('space', 'lot')),
    entity_id   INTEGER NOT NULL,
    file_path   TEXT NOT NULL,
    mime        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (owner_id, entity_type, entity_id)
);

CREATE INDEX idx_images_entity ON images(owner_id, entity_type, entity_id);