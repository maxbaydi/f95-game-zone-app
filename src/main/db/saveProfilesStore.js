// @ts-check

function mapSaveProfileRow(row) {
  return {
    id: row.id,
    recordId: row.record_id,
    provider: row.provider,
    rootPath: row.root_path,
    strategy: {
      type: row.strategy_type,
      payload: JSON.parse(row.strategy_payload || "{}"),
    },
    confidence: Number(row.confidence) || 0,
    reasons: JSON.parse(row.reasons_json || "[]"),
    detectedAt: row.detected_at,
    lastSeenAt: row.last_seen_at,
  };
}

function getSaveProfiles(db, recordId) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT id, record_id, provider, root_path, strategy_type, strategy_payload,
               confidence, reasons_json, detected_at, last_seen_at
        FROM save_profiles
        WHERE record_id = ?
        ORDER BY confidence DESC, root_path ASC
      `,
      [recordId],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve((rows || []).map(mapSaveProfileRow));
      },
    );
  });
}

function replaceSaveProfiles(db, recordId, profiles) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`DELETE FROM save_profiles WHERE record_id = ?`, [recordId], (deleteErr) => {
        if (deleteErr) {
          reject(deleteErr);
          return;
        }

        if (!profiles.length) {
          resolve([]);
          return;
        }

        const now = new Date().toISOString();
        const inserted = [];
        const statement = db.prepare(
          `
            INSERT INTO save_profiles
            (
              record_id,
              provider,
              root_path,
              strategy_type,
              strategy_payload,
              confidence,
              reasons_json,
              detected_at,
              last_seen_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        );

        let index = 0;
        const insertNext = () => {
          if (index >= profiles.length) {
            statement.finalize((finalizeErr) => {
              if (finalizeErr) {
                reject(finalizeErr);
                return;
              }

              resolve(inserted);
            });
            return;
          }

          const profile = profiles[index++];
          statement.run(
            [
              recordId,
              profile.provider,
              profile.rootPath,
              profile.strategy.type,
              JSON.stringify(profile.strategy.payload || {}),
              Number(profile.confidence) || 0,
              JSON.stringify(profile.reasons || []),
              now,
              now,
            ],
            function onInsert(err) {
              if (err) {
                statement.finalize(() => reject(err));
                return;
              }

              inserted.push({
                id: this.lastID,
                recordId,
                provider: profile.provider,
                rootPath: profile.rootPath,
                strategy: profile.strategy,
                confidence: Number(profile.confidence) || 0,
                reasons: profile.reasons || [],
                detectedAt: now,
                lastSeenAt: now,
              });

              insertNext();
            },
          );
        };

        insertNext();
      });
    });
  });
}

module.exports = {
  getSaveProfiles,
  replaceSaveProfiles,
};
