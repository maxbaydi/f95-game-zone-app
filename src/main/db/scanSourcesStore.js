// @ts-check

/**
 * @param {{ id: number, path: string, is_enabled: number, created_at: string, updated_at: string }} row
 */
function mapScanSourceRow(row) {
  return {
    id: row.id,
    path: row.path,
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {import("sqlite3").Database} db
 * @returns {Promise<Array<{ id: number, path: string, isEnabled: boolean, createdAt: string, updatedAt: string }>>}
 */
function getScanSources(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT id, path, is_enabled, created_at, updated_at
        FROM scan_sources
        ORDER BY created_at ASC, id ASC
      `,
      [],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve((rows || []).map(mapScanSourceRow));
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @param {string} sourcePath
 */
function addScanSource(db, sourcePath) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();

    db.run(
      `
        INSERT INTO scan_sources (path, is_enabled, created_at, updated_at)
        VALUES (?, 1, ?, ?)
      `,
      [sourcePath, now, now],
      function onInsert(err) {
        if (err) {
          reject(err);
          return;
        }

        db.get(
          `
            SELECT id, path, is_enabled, created_at, updated_at
            FROM scan_sources
            WHERE id = ?
          `,
          [this.lastID],
          (selectErr, row) => {
            if (selectErr) {
              reject(selectErr);
              return;
            }

            resolve(mapScanSourceRow(row));
          },
        );
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @param {number} sourceId
 * @param {{ path?: string, isEnabled?: boolean }} changes
 */
function updateScanSource(db, sourceId, changes) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT id, path, is_enabled, created_at, updated_at
        FROM scan_sources
        WHERE id = ?
      `,
      [sourceId],
      (getErr, row) => {
        if (getErr) {
          reject(getErr);
          return;
        }

        if (!row) {
          resolve(null);
          return;
        }

        const nextPath =
          typeof changes.path === "string" ? changes.path : row.path;
        const nextEnabled =
          typeof changes.isEnabled === "boolean"
            ? Number(changes.isEnabled)
            : row.is_enabled;
        const nextUpdatedAt = new Date().toISOString();

        db.run(
          `
            UPDATE scan_sources
            SET path = ?, is_enabled = ?, updated_at = ?
            WHERE id = ?
          `,
          [nextPath, nextEnabled, nextUpdatedAt, sourceId],
          (updateErr) => {
            if (updateErr) {
              reject(updateErr);
              return;
            }

            db.get(
              `
                SELECT id, path, is_enabled, created_at, updated_at
                FROM scan_sources
                WHERE id = ?
              `,
              [sourceId],
              (selectErr, nextRow) => {
                if (selectErr) {
                  reject(selectErr);
                  return;
                }

                resolve(mapScanSourceRow(nextRow));
              },
            );
          },
        );
      },
    );
  });
}

/**
 * @param {import("sqlite3").Database} db
 * @param {number} sourceId
 * @returns {Promise<{ success: boolean }>}
 */
function removeScanSource(db, sourceId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM scan_sources WHERE id = ?`,
      [sourceId],
      function onDelete(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({ success: this.changes > 0 });
      },
    );
  });
}

module.exports = {
  getScanSources,
  addScanSource,
  updateScanSource,
  removeScanSource,
};
