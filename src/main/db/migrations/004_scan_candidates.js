// @ts-check

module.exports = {
  version: 4,
  name: "scan_candidates",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS scan_candidates
      (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER REFERENCES scan_sources (id),
        last_job_id INTEGER REFERENCES scan_jobs (id),
        library_record_id INTEGER REFERENCES games (record_id),
        folder_path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        creator TEXT NOT NULL,
        engine TEXT,
        version TEXT,
        executable_name TEXT,
        atlas_id TEXT,
        f95_id TEXT,
        is_archive INTEGER NOT NULL DEFAULT 0,
        detection_score INTEGER NOT NULL DEFAULT 0,
        detection_reasons_json TEXT,
        match_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'detected',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        imported_at TEXT
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_status_last_seen
      ON scan_candidates (status, last_seen_at DESC);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_source_last_seen
      ON scan_candidates (source_id, last_seen_at DESC);
    `,
  ],
};
