// @ts-check

module.exports = {
  version: 3,
  name: "scan_jobs",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS scan_jobs
      (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        source_count INTEGER NOT NULL DEFAULT 0,
        games_found INTEGER NOT NULL DEFAULT 0,
        errors_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        notes_json TEXT
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_scan_jobs_started_at
      ON scan_jobs (started_at DESC);
    `,
  ],
};
