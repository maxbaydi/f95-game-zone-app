// @ts-check

/**
 * Storage of the app's own metadata catalog (table f95_catalog, migration
 * 012) and of the sync bookkeeping (f95_catalog_sync). Pure data access:
 * the network side lives in src/main/catalog.
 */

const { buildCompactScanKey } = require("../../shared/scanMatchUtils");

/**
 * @typedef {{
 *   fullDone: boolean,
 *   fullNextPage: number,
 *   totalPages: number,
 *   newestTs: number,
 *   lastRunAt: string,
 *   lastSuccessAt: string,
 *   lastError: string,
 *   definitionsAt: string,
 *   definitions: import("../catalog/f95CatalogParser").CatalogDefinitions | null,
 * }} CatalogSyncState
 */

/** @type {CatalogSyncState} */
const CATALOG_SYNC_DEFAULTS = Object.freeze({
  fullDone: false,
  fullNextPage: 1,
  totalPages: 0,
  newestTs: 0,
  lastRunAt: "",
  lastSuccessAt: "",
  lastError: "",
  definitionsAt: "",
  definitions: null,
});

/**
 * @param {{ run: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<{ changes: number, lastID: number }>}
 */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ changes: Number(this?.changes || 0), lastID: Number(this?.lastID || 0) });
    });
  });
}

/**
 * @param {{ all: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<any[]>}
 */
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

/**
 * @param {{ get: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<any | null>}
 */
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toPositiveInteger(value) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/**
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
function splitList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
function parseScreens(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return splitList(text);
}

const ENTRY_COLUMN_NAMES = [
  "f95_id", "title", "creator", "version", "engine", "status", "category",
  "prefix_ids", "prefixes", "tag_ids", "tags", "cover_url", "screens",
  "rating", "likes", "views", "updated_ts", "site_url", "overview", "first_seen_at", "last_seen_at",
];
const ENTRY_COLUMNS = ENTRY_COLUMN_NAMES.join(", ");
const QUALIFIED_ENTRY_COLUMNS = ENTRY_COLUMN_NAMES.map((name) => `f95_catalog.${name}`).join(", ");

/**
 * @typedef {{
 *   f95Id: number,
 *   title: string,
 *   creator: string,
 *   version: string,
 *   engine: string,
 *   status: string,
 *   category: string,
 *   prefixIds: number[],
 *   prefixes: string[],
 *   tagIds: number[],
 *   tags: string[],
 *   coverUrl: string,
 *   screens: string[],
 *   rating: number,
 *   likes: number,
 *   views: number,
 *   updatedTs: number,
 *   siteUrl: string,
 *   overview: string,
 *   firstSeenAt: string,
 *   lastSeenAt: string,
 * }} StoredCatalogEntry
 */

/**
 * @param {any} row
 * @returns {StoredCatalogEntry}
 */
function rowToEntry(row) {
  return {
    f95Id: Number(row.f95_id),
    title: String(row.title || ""),
    creator: String(row.creator || ""),
    version: String(row.version || ""),
    engine: String(row.engine || ""),
    status: String(row.status || ""),
    category: String(row.category || "games"),
    prefixIds: splitList(row.prefix_ids).map(Number).filter((id) => Number.isInteger(id) && id > 0),
    prefixes: splitList(row.prefixes),
    tagIds: splitList(row.tag_ids).map(Number).filter((id) => Number.isInteger(id) && id > 0),
    tags: splitList(row.tags),
    coverUrl: String(row.cover_url || ""),
    screens: parseScreens(row.screens),
    rating: Number(row.rating) || 0,
    likes: Number(row.likes) || 0,
    views: Number(row.views) || 0,
    updatedTs: Number(row.updated_ts) || 0,
    siteUrl: String(row.site_url || ""),
    overview: String(row.overview || ""),
    firstSeenAt: String(row.first_seen_at || ""),
    lastSeenAt: String(row.last_seen_at || ""),
  };
}

const UPSERT_SQL = `
  INSERT INTO f95_catalog (
    f95_id, title, creator, version, engine, status, category,
    prefix_ids, prefixes, tag_ids, tags, cover_url, screens,
    rating, likes, views, updated_ts, site_url, first_seen_at, last_seen_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(f95_id) DO UPDATE SET
    title = excluded.title,
    creator = excluded.creator,
    version = excluded.version,
    engine = excluded.engine,
    status = excluded.status,
    category = excluded.category,
    prefix_ids = excluded.prefix_ids,
    prefixes = excluded.prefixes,
    tag_ids = excluded.tag_ids,
    tags = excluded.tags,
    cover_url = excluded.cover_url,
    screens = excluded.screens,
    rating = excluded.rating,
    likes = excluded.likes,
    views = excluded.views,
    updated_ts = excluded.updated_ts,
    site_url = excluded.site_url,
    last_seen_at = excluded.last_seen_at
  WHERE
    f95_catalog.title IS NOT excluded.title OR
    f95_catalog.creator IS NOT excluded.creator OR
    f95_catalog.version IS NOT excluded.version OR
    f95_catalog.engine IS NOT excluded.engine OR
    f95_catalog.status IS NOT excluded.status OR
    f95_catalog.prefix_ids IS NOT excluded.prefix_ids OR
    f95_catalog.tag_ids IS NOT excluded.tag_ids OR
    f95_catalog.tags IS NOT excluded.tags OR
    f95_catalog.cover_url IS NOT excluded.cover_url OR
    f95_catalog.screens IS NOT excluded.screens OR
    f95_catalog.rating IS NOT excluded.rating OR
    f95_catalog.likes IS NOT excluded.likes OR
    f95_catalog.views IS NOT excluded.views OR
    f95_catalog.updated_ts IS NOT excluded.updated_ts OR
    f95_catalog.site_url IS NOT excluded.site_url
`;

/**
 * Writes a batch of parsed entries in one transaction. Rows that did not
 * change are left untouched (so `changed` counts real updates); `added`
 * counts ids the catalog did not have before.
 *
 * @param {any} db
 * @param {Array<import("../catalog/f95CatalogParser").CatalogEntry | null | undefined>} entries
 * @param {{ now?: () => Date }=} options
 * @returns {Promise<{ written: number, added: number, changed: number, versionChanged: number }>}
 */
async function upsertCatalogEntries(db, entries, options = {}) {
  const list = Array.isArray(entries) ? entries.filter((entry) => entry && toPositiveInteger(entry.f95Id)) : [];
  if (list.length === 0) {
    return { written: 0, added: 0, changed: 0, versionChanged: 0 };
  }
  const stamp = (options.now || (() => new Date()))().toISOString();
  const ids = list.map((entry) => entry.f95Id);
  /** @type {Map<number, string>} */
  const existingVersions = new Map();
  for (let index = 0; index < ids.length; index += 1000) {
    const chunk = ids.slice(index, index + 1000);
    const rows = await all(
      db,
      `SELECT f95_id, version FROM f95_catalog WHERE f95_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const row of rows) {
      existingVersions.set(Number(row.f95_id), String(row.version || ""));
    }
  }

  await run(db, "BEGIN IMMEDIATE TRANSACTION");
  let changed = 0;
  let versionChanged = 0;
  try {
    for (const entry of list) {
      const result = await run(db, UPSERT_SQL, [
        entry.f95Id,
        entry.title,
        entry.creator || "",
        entry.version || "",
        entry.engine || "",
        entry.status || "",
        entry.category || "games",
        (entry.prefixIds || []).join(","),
        (entry.prefixes || []).join(","),
        (entry.tagIds || []).join(","),
        (entry.tags || []).join(","),
        entry.coverUrl || "",
        JSON.stringify(entry.screens || []),
        Number(entry.rating) || 0,
        Number(entry.likes) || 0,
        Number(entry.views) || 0,
        Number(entry.updatedTs) || 0,
        entry.siteUrl || "",
        stamp,
        stamp,
      ]);
      if (result.changes > 0) {
        changed += 1;
        if (existingVersions.has(entry.f95Id) && existingVersions.get(entry.f95Id) !== String(entry.version || "")) {
          versionChanged += 1;
        }
      }
    }
    await run(db, "COMMIT");
  } catch (error) {
    await run(db, "ROLLBACK").catch(() => {});
    throw error;
  }

  const added = ids.filter((id) => !existingVersions.has(id)).length;
  return { written: list.length, added, changed, versionChanged };
}

/**
 * @param {any} db
 * @param {number} f95Id
 * @param {string} overview
 */
async function setCatalogOverview(db, f95Id, overview) {
  const id = toPositiveInteger(f95Id);
  if (!id) {
    return false;
  }
  const result = await run(db, "UPDATE f95_catalog SET overview = ? WHERE f95_id = ?", [String(overview || ""), id]);
  return result.changes > 0;
}

/**
 * @param {any} db
 * @param {number | string} f95Id
 * @returns {Promise<StoredCatalogEntry | null>}
 */
async function getCatalogEntry(db, f95Id) {
  const id = toPositiveInteger(f95Id);
  if (!id) {
    return null;
  }
  const row = await get(db, `SELECT ${ENTRY_COLUMNS} FROM f95_catalog WHERE f95_id = ?`, [id]);
  return row ? rowToEntry(row) : null;
}

/**
 * @param {any} db
 * @param {Array<number | string>} f95Ids
 * @returns {Promise<Map<number, StoredCatalogEntry>>}
 */
async function getCatalogEntries(db, f95Ids) {
  const ids = [...new Set((f95Ids || []).map(toPositiveInteger).filter(Boolean))];
  const result = new Map();
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    const rows = await all(
      db,
      `SELECT ${ENTRY_COLUMNS} FROM f95_catalog WHERE f95_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const row of rows) {
      const entry = rowToEntry(row);
      result.set(entry.f95Id, entry);
    }
  }
  return result;
}

/**
 * The catalog entry linked to a library record (through f95_zone_mappings).
 * @param {any} db
 * @param {number | string} recordId
 * @returns {Promise<StoredCatalogEntry | null>}
 */
async function getCatalogEntryForRecord(db, recordId) {
  const id = toPositiveInteger(recordId);
  if (!id) {
    return null;
  }
  const row = await get(
    db,
    `
      SELECT ${QUALIFIED_ENTRY_COLUMNS}
      FROM f95_zone_mappings m
      JOIN f95_catalog ON f95_catalog.f95_id = m.f95_id
      WHERE m.record_id = ?
    `,
    [id],
  );
  return row ? rowToEntry(row) : null;
}

/**
 * The thread id a library record is linked to, or 0.
 * @param {any} db
 * @param {number | string} recordId
 */
async function getF95IdForRecord(db, recordId) {
  const id = toPositiveInteger(recordId);
  if (!id) {
    return 0;
  }
  const row = await get(db, "SELECT f95_id FROM f95_zone_mappings WHERE record_id = ?", [id]);
  return toPositiveInteger(row?.f95_id);
}

/**
 * @param {string} value
 */
function likePattern(value) {
  return `%${String(value || "").trim().replace(/[%_\\]/g, (character) => `\\${character}`)}%`;
}

/**
 * Title/creator lookup for the "Link to catalog" dialog. Exact title matches
 * (compared without punctuation and case) come first, then the rest by
 * popularity.
 *
 * @param {any} db
 * @param {{ title?: string, creator?: string, limit?: number }} input
 * @returns {Promise<StoredCatalogEntry[]>}
 */
async function searchCatalogEntries(db, input = {}) {
  const title = String(input.title || "").trim();
  const creator = String(input.creator || "").trim();
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 60));
  if (!title && !creator) {
    return [];
  }
  const where = [];
  const params = [];
  if (title) {
    where.push("title LIKE ? ESCAPE '\\'");
    params.push(likePattern(title));
  }
  if (creator) {
    where.push("creator LIKE ? ESCAPE '\\'");
    params.push(likePattern(creator));
  }
  let rows = await all(
    db,
    `SELECT ${ENTRY_COLUMNS} FROM f95_catalog WHERE ${where.join(" AND ")} ORDER BY likes DESC LIMIT ?`,
    [...params, limit * 2],
  );
  if (rows.length === 0 && title && creator) {
    rows = await all(
      db,
      `SELECT ${ENTRY_COLUMNS} FROM f95_catalog WHERE title LIKE ? ESCAPE '\\' ORDER BY likes DESC LIMIT ?`,
      [likePattern(title), limit * 2],
    );
  }
  if (rows.length === 0 && title) {
    // Folder names often drop punctuation and spaces ("MsMorisson"): compare
    // compact keys. Titles alone are small enough to scan in memory.
    const compact = buildCompactScanKey(title);
    if (compact.length >= 3) {
      const titles = await all(db, "SELECT f95_id, title FROM f95_catalog");
      const matchedIds = titles
        .filter((row) => {
          const key = buildCompactScanKey(row.title);
          return key === compact || (compact.length >= 6 && key.startsWith(compact));
        })
        .map((row) => Number(row.f95_id))
        .slice(0, limit * 2);
      if (matchedIds.length > 0) {
        rows = await all(
          db,
          `SELECT ${ENTRY_COLUMNS} FROM f95_catalog WHERE f95_id IN (${matchedIds.map(() => "?").join(",")})`,
          matchedIds,
        );
      }
    }
  }
  const compactTitle = buildCompactScanKey(title);
  return rows
    .map(rowToEntry)
    .sort((left, right) => {
      const leftExact = compactTitle && buildCompactScanKey(left.title) === compactTitle ? 1 : 0;
      const rightExact = compactTitle && buildCompactScanKey(right.title) === compactTitle ? 1 : 0;
      return rightExact - leftExact || right.likes - left.likes;
    })
    .slice(0, limit);
}

/**
 * Rows the scan matcher indexes (every entry; the matcher builds its own
 * token index in memory).
 * @param {any} db
 * @returns {Promise<Array<{ f95_id: number, title: string, creator: string, engine: string, version: string, site_url: string }>>}
 */
function listCatalogEntriesForMatcher(db) {
  return all(db, "SELECT f95_id, title, creator, engine, version, site_url FROM f95_catalog");
}

/**
 * Every entry, in the shape the site search filters in memory.
 * @param {any} db
 * @returns {Promise<StoredCatalogEntry[]>}
 */
async function listCatalogEntries(db) {
  const rows = await all(db, `SELECT ${ENTRY_COLUMNS} FROM f95_catalog ORDER BY updated_ts DESC`);
  return rows.map(rowToEntry);
}

/**
 * @param {any} db
 * @returns {Promise<{ categories: string[], engines: string[], statuses: string[], tags: string[] }>}
 */
async function getCatalogFilterOptions(db) {
  const [categories, engines, statuses, tagRows] = await Promise.all([
    all(db, "SELECT DISTINCT category FROM f95_catalog WHERE category != '' ORDER BY category"),
    all(db, "SELECT DISTINCT engine FROM f95_catalog WHERE engine != '' ORDER BY engine"),
    all(db, "SELECT DISTINCT status FROM f95_catalog WHERE status != '' ORDER BY status"),
    all(db, "SELECT DISTINCT tags FROM f95_catalog WHERE tags != ''"),
  ]);
  const tags = new Set();
  for (const row of tagRows) {
    for (const tag of splitList(row.tags)) {
      tags.add(tag);
    }
  }
  return {
    categories: categories.map((row) => String(row.category)),
    engines: engines.map((row) => String(row.engine)),
    statuses: statuses.map((row) => String(row.status)),
    tags: [...tags].sort((left, right) => left.localeCompare(right)),
  };
}

/**
 * @param {any} db
 * @returns {Promise<number>}
 */
async function countCatalogEntries(db) {
  const row = await get(db, "SELECT COUNT(*) AS count FROM f95_catalog");
  return Number(row?.count) || 0;
}

/**
 * @param {any} db
 * @returns {Promise<CatalogSyncState & { entryCount: number }>}
 */
async function getCatalogSyncState(db) {
  const rows = await all(db, "SELECT key, value FROM f95_catalog_sync");
  const raw = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value ?? "")]));
  let definitions = null;
  if (raw.definitions) {
    try {
      definitions = JSON.parse(raw.definitions);
    } catch {
      definitions = null;
    }
  }
  return {
    fullDone: raw.fullDone === "1",
    fullNextPage: toPositiveInteger(raw.fullNextPage) || 1,
    totalPages: toPositiveInteger(raw.totalPages),
    newestTs: toPositiveInteger(raw.newestTs),
    lastRunAt: raw.lastRunAt || "",
    lastSuccessAt: raw.lastSuccessAt || "",
    lastError: raw.lastError || "",
    definitionsAt: raw.definitionsAt || "",
    definitions,
    entryCount: await countCatalogEntries(db),
  };
}

/**
 * @param {any} db
 * @param {Partial<CatalogSyncState>} patch
 */
async function saveCatalogSyncState(db, patch) {
  const pairs = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) {
      continue;
    }
    let stored;
    if (key === "definitions") {
      stored = value ? JSON.stringify(value) : "";
    } else if (typeof value === "boolean") {
      stored = value ? "1" : "0";
    } else {
      stored = String(value ?? "");
    }
    pairs.push([key, stored]);
  }
  if (pairs.length === 0) {
    return;
  }
  await run(db, "BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const [key, value] of pairs) {
      await run(
        db,
        "INSERT INTO f95_catalog_sync (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    }
    await run(db, "COMMIT");
  } catch (error) {
    await run(db, "ROLLBACK").catch(() => {});
    throw error;
  }
}

module.exports = {
  CATALOG_SYNC_DEFAULTS,
  countCatalogEntries,
  getCatalogEntries,
  getCatalogEntry,
  getCatalogEntryForRecord,
  getCatalogFilterOptions,
  getCatalogSyncState,
  getF95IdForRecord,
  listCatalogEntries,
  listCatalogEntriesForMatcher,
  rowToEntry,
  saveCatalogSyncState,
  searchCatalogEntries,
  setCatalogOverview,
  upsertCatalogEntries,
};
