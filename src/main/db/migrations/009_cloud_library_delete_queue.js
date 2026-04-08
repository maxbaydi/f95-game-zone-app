// @ts-check

module.exports = {
  version: 9,
  name: "cloud_library_delete_queue",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS cloud_library_delete_queue
      (
        request_key TEXT PRIMARY KEY,
        cloud_project_key TEXT NOT NULL,
        record_id INTEGER,
        preferred_identity_key TEXT NOT NULL,
        candidate_identity_keys_json TEXT NOT NULL DEFAULT '[]',
        atlas_id TEXT NOT NULL DEFAULT '',
        f95_id TEXT NOT NULL DEFAULT '',
        site_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        creator TEXT NOT NULL DEFAULT '',
        requested_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT ''
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_cloud_library_delete_queue_project_requested
      ON cloud_library_delete_queue (cloud_project_key, requested_at);
    `,
  ],
};
