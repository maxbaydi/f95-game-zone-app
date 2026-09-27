// @ts-check

/**
 * Latest version seen on each game's F95 thread by the background thread
 * check (ADR 0009). One row per library record; the catalog version stays in
 * atlas_data and the newer of both becomes `latestVersion`.
 */
module.exports = {
  version: 11,
  name: "library_live_versions",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS library_live_versions
      (
        record_id INTEGER PRIMARY KEY REFERENCES games (record_id) ON DELETE CASCADE,
        thread_url TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        checked_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT ''
      );
    `,
  ],
};
