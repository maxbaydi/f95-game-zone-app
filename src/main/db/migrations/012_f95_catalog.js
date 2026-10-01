// @ts-check

/**
 * The app's own metadata catalog, keyed by the F95 thread id and filled by
 * the catalog sync (src/main/catalog). It replaces the tables that used to be
 * downloaded as a package from the external Atlas feed (atlas_data,
 * f95_zone_data and their satellites).
 *
 * Library records keep their catalog link through f95_zone_mappings: every
 * old Atlas mapping whose entry had an F95 thread is carried over, and the
 * rows of the old catalog that had a thread seed the new table so nothing
 * disappears before the first sync (updated_ts = 0 marks them stale).
 */
module.exports = {
  version: 12,
  name: "f95_catalog",
  statements: [
    `
      CREATE TABLE IF NOT EXISTS f95_catalog
      (
        f95_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        creator TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        engine TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'games',
        prefix_ids TEXT NOT NULL DEFAULT '',
        prefixes TEXT NOT NULL DEFAULT '',
        tag_ids TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        screens TEXT NOT NULL DEFAULT '',
        rating REAL NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        updated_ts INTEGER NOT NULL DEFAULT 0,
        site_url TEXT NOT NULL DEFAULT '',
        overview TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT NOT NULL DEFAULT ''
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_f95_catalog_updated_ts
      ON f95_catalog (updated_ts DESC);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_f95_catalog_title
      ON f95_catalog (title COLLATE NOCASE);
    `,
    `
      CREATE TABLE IF NOT EXISTS f95_catalog_sync
      (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
    `,
    `
      INSERT OR IGNORE INTO f95_zone_mappings (record_id, f95_id, site_url)
      SELECT am.record_id, fz.f95_id, COALESCE(fz.site_url, '')
      FROM atlas_mappings am
      JOIN f95_zone_data fz ON fz.atlas_id = am.atlas_id
      WHERE fz.f95_id IS NOT NULL;
    `,
    `
      INSERT OR IGNORE INTO f95_catalog
        (f95_id, title, creator, version, engine, status, tags, cover_url, site_url, updated_ts)
      SELECT
        fz.f95_id,
        ad.title,
        COALESCE(ad.creator, ''),
        COALESCE(ad.version, ''),
        COALESCE(ad.engine, ''),
        COALESCE(ad.status, ''),
        COALESCE(fz.tags, ''),
        COALESCE(fz.banner_url, ''),
        COALESCE(fz.site_url, ''),
        0
      FROM f95_zone_data fz
      JOIN atlas_data ad ON ad.atlas_id = fz.atlas_id
      WHERE fz.f95_id IS NOT NULL AND ad.title IS NOT NULL AND ad.title != '';
    `,
    `DROP TABLE IF EXISTS atlas_tags;`,
    `DROP TABLE IF EXISTS atlas_previews;`,
    `DROP TABLE IF EXISTS atlas_mappings;`,
    `DROP TABLE IF EXISTS f95_zone_tags;`,
    `DROP TABLE IF EXISTS f95_zone_screens;`,
    `DROP TABLE IF EXISTS f95_zone_data;`,
    `DROP TABLE IF EXISTS atlas_data;`,
    `DROP TABLE IF EXISTS updates;`,
  ],
};
