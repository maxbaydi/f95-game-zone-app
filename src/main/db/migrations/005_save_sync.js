// @ts-check

module.exports = {
  version: 5,
  name: "save_sync",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS save_profiles
      (
        id INTEGER PRIMARY KEY,
        record_id INTEGER REFERENCES games(record_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        root_path TEXT NOT NULL,
        strategy_type TEXT NOT NULL,
        strategy_payload TEXT NOT NULL,
        confidence INTEGER NOT NULL DEFAULT 0,
        reasons_json TEXT NOT NULL DEFAULT '[]',
        detected_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (record_id, root_path)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS save_sync_state
      (
        record_id INTEGER PRIMARY KEY REFERENCES games(record_id) ON DELETE CASCADE,
        cloud_identity TEXT NOT NULL,
        last_local_manifest_hash TEXT,
        last_remote_manifest_hash TEXT,
        last_uploaded_at TEXT,
        last_downloaded_at TEXT,
        last_remote_path TEXT,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
    `,
  ],
};
