// @ts-check

/**
 * Fields the Latest Updates list does not carry but the starter post of a
 * thread does: overview (already a column), release date, censorship,
 * platforms, languages, developer line. Filled by the thread inspector
 * whenever a thread is opened or checked (src/main/f95/threadDetails.js).
 */
module.exports = {
  version: 13,
  name: "f95_catalog_thread_details",
  statements: [
    `ALTER TABLE f95_catalog ADD COLUMN release_date TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE f95_catalog ADD COLUMN censored TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE f95_catalog ADD COLUMN os TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE f95_catalog ADD COLUMN language TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE f95_catalog ADD COLUMN developer TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE f95_catalog ADD COLUMN details_at TEXT NOT NULL DEFAULT '';`,
  ],
};
