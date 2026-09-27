// @ts-check

/**
 * Storage of the latest version seen on each game's F95 thread
 * (`library_live_versions`, migration 011).
 */

/**
 * @typedef {{
 *   recordId: number,
 *   threadUrl: string,
 *   version: string,
 *   title: string,
 *   checkedAt: string,
 *   error: string
 * }} LiveVersionRecord
 */

/**
 * @param {{ run: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<{ changes?: number }>}
 */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this || {});
    });
  });
}

/**
 * @param {{ get: Function }} db
 * @param {string} sql
 * @param {unknown[]=} params
 * @returns {Promise<any>}
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
function normalizeRecordId(value) {
  const recordId = Number(value);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("A valid library record id is required.");
  }
  return recordId;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Stores the result of one thread check. A failed check (empty version with
 * an error) of the same thread keeps the last version that was read
 * successfully, so a timeout does not hide a known update.
 *
 * @param {{ run: Function }} db
 * @param {{
 *   recordId: number,
 *   threadUrl?: string,
 *   version?: string,
 *   title?: string,
 *   checkedAt?: string,
 *   error?: string
 * }} input
 * @returns {Promise<void>}
 */
async function upsertLiveVersion(db, input) {
  const recordId = normalizeRecordId(input?.recordId);
  const checkedAt = normalizeText(input?.checkedAt) || new Date().toISOString();

  await run(
    db,
    `
      INSERT INTO library_live_versions
        (record_id, thread_url, version, title, checked_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        version = CASE
          WHEN excluded.version = '' AND excluded.last_error <> ''
            AND library_live_versions.thread_url = excluded.thread_url
          THEN library_live_versions.version
          ELSE excluded.version
        END,
        title = CASE
          WHEN excluded.version = '' AND excluded.last_error <> ''
            AND library_live_versions.thread_url = excluded.thread_url
          THEN library_live_versions.title
          ELSE excluded.title
        END,
        thread_url = excluded.thread_url,
        checked_at = excluded.checked_at,
        last_error = excluded.last_error
    `,
    [
      recordId,
      normalizeText(input?.threadUrl),
      normalizeText(input?.version),
      normalizeText(input?.title),
      checkedAt,
      normalizeText(input?.error),
    ],
  );
}

/**
 * @param {{ get: Function }} db
 * @param {number} recordId
 * @returns {Promise<LiveVersionRecord | null>}
 */
async function getLiveVersion(db, recordId) {
  const row = await get(
    db,
    `
      SELECT record_id, thread_url, version, title, checked_at, last_error
      FROM library_live_versions
      WHERE record_id = ?
    `,
    [normalizeRecordId(recordId)],
  );

  if (!row) {
    return null;
  }

  return {
    recordId: Number(row.record_id),
    threadUrl: String(row.thread_url || ""),
    version: String(row.version || ""),
    title: String(row.title || ""),
    checkedAt: String(row.checked_at || ""),
    error: String(row.last_error || ""),
  };
}

/**
 * @param {{ run: Function }} db
 * @param {number} recordId
 * @returns {Promise<number>} removed rows
 */
async function deleteLiveVersion(db, recordId) {
  const result = await run(
    db,
    "DELETE FROM library_live_versions WHERE record_id = ?",
    [normalizeRecordId(recordId)],
  );
  return Number(result?.changes || 0);
}

module.exports = {
  deleteLiveVersion,
  getLiveVersion,
  upsertLiveVersion,
};
