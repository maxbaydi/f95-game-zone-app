// @ts-check

function mapSaveSyncStateRow(row) {
  if (!row) {
    return null;
  }

  return {
    recordId: row.record_id,
    cloudIdentity: row.cloud_identity,
    lastLocalManifestHash: row.last_local_manifest_hash || "",
    lastRemoteManifestHash: row.last_remote_manifest_hash || "",
    lastUploadedAt: row.last_uploaded_at || "",
    lastDownloadedAt: row.last_downloaded_at || "",
    lastRemotePath: row.last_remote_path || "",
    syncStatus: row.sync_status || "idle",
    lastError: row.last_error || "",
    updatedAt: row.updated_at,
  };
}

function getSaveSyncState(db, recordId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT
          record_id,
          cloud_identity,
          last_local_manifest_hash,
          last_remote_manifest_hash,
          last_uploaded_at,
          last_downloaded_at,
          last_remote_path,
          sync_status,
          last_error,
          updated_at
        FROM save_sync_state
        WHERE record_id = ?
      `,
      [recordId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(mapSaveSyncStateRow(row));
      },
    );
  });
}

function upsertSaveSyncState(db, input) {
  return new Promise((resolve, reject) => {
    const updatedAt = new Date().toISOString();

    db.run(
      `
        INSERT INTO save_sync_state
        (
          record_id,
          cloud_identity,
          last_local_manifest_hash,
          last_remote_manifest_hash,
          last_uploaded_at,
          last_downloaded_at,
          last_remote_path,
          sync_status,
          last_error,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_id) DO UPDATE SET
          cloud_identity = excluded.cloud_identity,
          last_local_manifest_hash = excluded.last_local_manifest_hash,
          last_remote_manifest_hash = excluded.last_remote_manifest_hash,
          last_uploaded_at = excluded.last_uploaded_at,
          last_downloaded_at = excluded.last_downloaded_at,
          last_remote_path = excluded.last_remote_path,
          sync_status = excluded.sync_status,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `,
      [
        input.recordId,
        input.cloudIdentity,
        input.lastLocalManifestHash || "",
        input.lastRemoteManifestHash || "",
        input.lastUploadedAt || "",
        input.lastDownloadedAt || "",
        input.lastRemotePath || "",
        input.syncStatus || "idle",
        input.lastError || "",
        updatedAt,
      ],
      async (err) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          const row = await getSaveSyncState(db, input.recordId);
          resolve(row);
        } catch (readErr) {
          reject(readErr);
        }
      },
    );
  });
}

module.exports = {
  getSaveSyncState,
  upsertSaveSyncState,
};
