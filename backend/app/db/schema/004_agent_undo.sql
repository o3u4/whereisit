-- ============================================================================
-- whereisit schema v4: LLM agent delete-undo snapshots.
-- When the agent deletes items/spaces, the affected rows (+ preview image bytes)
-- are snapshotted here so the user can restore them after the run. One row per
-- agent run that performed any delete.
-- ============================================================================

CREATE TABLE agent_undo (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    data_json  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agent_undo_user ON agent_undo(user_id, id);