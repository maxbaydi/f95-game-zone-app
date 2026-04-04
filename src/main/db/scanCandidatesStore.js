// @ts-check

/**
 * @param {{
 *   id: number,
 *   source_id: number | null,
 *   last_job_id: number | null,
 *   library_record_id: number | null,
 *   folder_path: string,
 *   title: string,
 *   creator: string,
 *   engine: string | null,
 *   version: string | null,
 *   executable_name: string | null,
 *   atlas_id: string | null,
 *   f95_id: string | null,
 *   is_archive: number,
 *   detection_score: number,
 *   detection_reasons_json: string | null,
 *   match_count: number,
 *   status: string,
 *   first_seen_at: string,
 *   last_seen_at: string,
 *   imported_at: string | null
 * }} row
 */
function mapCandidateRow(row) {
  return {
    id: row.id,
    sourceId: row.source_id,
    lastJobId: row.last_job_id,
    libraryRecordId: row.library_record_id,
    folderPath: row.folder_path,
    title: row.title,
    creator: row.creator,
    engine: row.engine,
    version: row.version,
    executableName: row.executable_name,
    atlasId: row.atlas_id,
    f95Id: row.f95_id,
    isArchive: Boolean(row.is_archive),
    detectionScore: row.detection_score,
    detectionReasons: row.detection_reasons_json
      ? JSON.parse(row.detection_reasons_json)
      : [],
    matchCount: row.match_count,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    importedAt: row.imported_at,
  };
}

/**
 * @param {import("sqlite3").Database} db
 * @param {Array<{
 *   sourceId?: number | null,
 *   lastJobId?: number | null,
 *   folderPath: string,
 *   title: string,
 *   creator: string,
 *   engine?: string,
 *   version?: string,
 *   executableName?: string,
 *   atlasId?: string | number,
 *   f95Id?: string | number,
 *   isArchive?: boolean,
 *   detectionScore?: number,
 *   detectionReasons?: string[],
 *   matchCount?: number,
 *   status?: string
 * }>} candidates
 */
async function upsertScanCandidates(db, candidates) {
  const stored = [];

  for (const candidate of candidates) {
    const now = new Date().toISOString();

    await new Promise((resolve, reject) => {
      db.run(
        `
          INSERT INTO scan_candidates
            (
              source_id,
              last_job_id,
              folder_path,
              title,
              creator,
              engine,
              version,
              executable_name,
              atlas_id,
              f95_id,
              is_archive,
              detection_score,
              detection_reasons_json,
              match_count,
              status,
              first_seen_at,
              last_seen_at
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(folder_path) DO UPDATE SET
            source_id = excluded.source_id,
            last_job_id = excluded.last_job_id,
            title = excluded.title,
            creator = excluded.creator,
            engine = excluded.engine,
            version = excluded.version,
            executable_name = excluded.executable_name,
            atlas_id = excluded.atlas_id,
            f95_id = excluded.f95_id,
            is_archive = excluded.is_archive,
            detection_score = excluded.detection_score,
            detection_reasons_json = excluded.detection_reasons_json,
            match_count = excluded.match_count,
            status = excluded.status,
            last_seen_at = excluded.last_seen_at
        `,
        [
          candidate.sourceId || null,
          candidate.lastJobId || null,
          candidate.folderPath,
          candidate.title,
          candidate.creator,
          candidate.engine || null,
          candidate.version || null,
          candidate.executableName || null,
          candidate.atlasId ? String(candidate.atlasId) : null,
          candidate.f95Id ? String(candidate.f95Id) : null,
          candidate.isArchive ? 1 : 0,
          candidate.detectionScore || 0,
          candidate.detectionReasons
            ? JSON.stringify(candidate.detectionReasons)
            : null,
          candidate.matchCount || 0,
          candidate.status || "detected",
          now,
          now,
        ],
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(null);
        },
      );
    });

    const row = await new Promise((resolve, reject) => {
      db.get(
        `
          SELECT *
          FROM scan_candidates
          WHERE folder_path = ?
        `,
        [candidate.folderPath],
        (err, selectedRow) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(selectedRow);
        },
      );
    });

    stored.push(mapCandidateRow(row));
  }

  return stored;
}

/**
 * @param {import("sqlite3").Database} db
 * @param {string} folderPath
 * @param {number} recordId
 */
async function markScanCandidateImported(db, folderPath, recordId) {
  const importedAt = new Date().toISOString();

  await new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE scan_candidates
        SET
          status = 'imported',
          library_record_id = ?,
          imported_at = ?,
          last_seen_at = ?
        WHERE folder_path = ?
      `,
      [recordId, importedAt, importedAt, folderPath],
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(null);
      },
    );
  });

  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT *
        FROM scan_candidates
        WHERE folder_path = ?
      `,
      [folderPath],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(row ? mapCandidateRow(row) : null);
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @param {number=} limit
 */
function listScanCandidates(db, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT *
        FROM scan_candidates
        ORDER BY last_seen_at DESC, id DESC
        LIMIT ?
      `,
      [limit],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve((rows || []).map(mapCandidateRow));
      },
    );
  });
}

module.exports = {
  upsertScanCandidates,
  markScanCandidateImported,
  listScanCandidates,
};
