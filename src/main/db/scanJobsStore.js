// @ts-check

/**
 * @param {{ id: number, mode: string, status: string, source_count: number, games_found: number, errors_count: number, started_at: string, finished_at: string | null, notes_json: string | null }} row
 */
function mapScanJobRow(row) {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    sourceCount: row.source_count,
    gamesFound: row.games_found,
    errorsCount: row.errors_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    notes: row.notes_json ? JSON.parse(row.notes_json) : null,
  };
}

/**
 * @param {import("sqlite3").Database} db
 * @param {{ mode: string, status: string, sourceCount: number, gamesFound?: number, errorsCount?: number, notes?: unknown }} input
 */
function createScanJob(db, input) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    db.run(
      `
        INSERT INTO scan_jobs
          (mode, status, source_count, games_found, errors_count, started_at, notes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.mode,
        input.status,
        input.sourceCount,
        input.gamesFound || 0,
        input.errorsCount || 0,
        startedAt,
        input.notes ? JSON.stringify(input.notes) : null,
      ],
      function onInsert(err) {
        if (err) {
          reject(err);
          return;
        }

        db.get(
          `
            SELECT *
            FROM scan_jobs
            WHERE id = ?
          `,
          [this.lastID],
          (selectErr, row) => {
            if (selectErr) {
              reject(selectErr);
              return;
            }

            resolve(mapScanJobRow(row));
          },
        );
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @param {number} jobId
 * @param {{ status: string, gamesFound: number, errorsCount: number, notes?: unknown }} input
 */
function finishScanJob(db, jobId, input) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE scan_jobs
        SET status = ?, games_found = ?, errors_count = ?, finished_at = ?, notes_json = ?
        WHERE id = ?
      `,
      [
        input.status,
        input.gamesFound,
        input.errorsCount,
        new Date().toISOString(),
        input.notes ? JSON.stringify(input.notes) : null,
        jobId,
      ],
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        db.get(
          `
            SELECT *
            FROM scan_jobs
            WHERE id = ?
          `,
          [jobId],
          (selectErr, row) => {
            if (selectErr) {
              reject(selectErr);
              return;
            }

            resolve(mapScanJobRow(row));
          },
        );
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @param {number=} limit
 */
function listScanJobs(db, limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT *
        FROM scan_jobs
        ORDER BY started_at DESC, id DESC
        LIMIT ?
      `,
      [limit],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve((rows || []).map(mapScanJobRow));
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @returns {Promise<{ deleted: number }>}
 */
function clearScanJobs(db) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM scan_jobs`, [], function onDelete(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        deleted: this.changes || 0,
      });
    });
  });
}

module.exports = {
  createScanJob,
  finishScanJob,
  listScanJobs,
  clearScanJobs,
};
