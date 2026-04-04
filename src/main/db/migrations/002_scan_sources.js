// @ts-check

module.exports = {
  version: 2,
  name: "scan_sources",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS scan_sources
      (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_scan_sources_enabled
      ON scan_sources (is_enabled);
    `,
  ],
};
