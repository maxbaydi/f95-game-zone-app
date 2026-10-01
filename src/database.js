// @ts-nocheck

const path = require("path");
const fs = require("fs").promises;
const { resolveStoredImagePath, toRendererPath } = require("./main/assetPaths");
const { openDatabase } = require("./main/db/openDatabase");
const { filterSiteCatalogEntries } = require("./shared/siteSearch");
const catalogStore = require("./main/db/f95CatalogStore");
const {
  buildVersionUpdateState,
  pickNewerVersion,
} = require("./shared/versionUpdate");

let db;

const initializeDatabase = (dataDirOrPaths, options = {}) => {
  return openDatabase(dataDirOrPaths, options).then((database) => {
    db = database;
    return db;
  });
};

/**
 * Live handle of the open database. `module.exports.db` is captured at
 * require time (before initializeDatabase ran) and is therefore undefined
 * for callers; use this accessor instead.
 */
const getDb = () => db;

const resolveBannerPath = (appPaths, bannerPath) => {
  if (!bannerPath) {
    return null;
  }

  return toRendererPath(resolveStoredImagePath(appPaths, bannerPath));
};

const resolveBannerUrl = (appPaths, localBannerPath, remoteBannerUrl) =>
  resolveBannerPath(appPaths, localBannerPath) || remoteBannerUrl || null;

const buildDisplayText = (localValue, remoteValue) =>
  remoteValue || localValue || "";

/**
 * Splits the joined version columns of a game row: the catalog version
 * (`catalogLatestVersion`), the version last read from the live F95 thread
 * (`liveVersion`, `liveCheckedAt`) and the newer of both as `latestVersion`.
 */
const resolveLatestVersionFields = (row) => {
  const { live_version: liveVersionColumn, live_checked_at: liveCheckedAtColumn, ...rest } =
    row;
  const catalogLatestVersion = String(row.latestVersion || "");
  const liveVersion = String(liveVersionColumn || "");
  return {
    rest,
    catalogLatestVersion,
    liveVersion,
    liveCheckedAt: String(liveCheckedAtColumn || ""),
    latestVersion: pickNewerVersion(catalogLatestVersion, liveVersion),
  };
};

const GAME_METADATA_SELECT = `
  games.record_id as record_id,
  games.title as title,
  games.creator as creator,
  games.engine as engine,
  games.is_favorite as isFavorite,
  games.description,
  games.total_playtime,
  games.last_played_r,
  games.last_played_version,
  banners.path as banner_path,
  NULLIF(catalog.cover_url, '') as remote_banner_url,
  COALESCE(f95_zone_mappings.f95_id, catalog.f95_id) as f95_id,
  COALESCE(
    NULLIF(f95_zone_mappings.site_url, ''),
    NULLIF(catalog.site_url, '')
  ) as siteUrl,
  catalog.views as views,
  catalog.likes as likes,
  catalog.tags as f95_tags,
  catalog.rating as rating,
  catalog.title as catalog_title,
  catalog.creator as catalog_creator,
  catalog.engine as catalog_engine,
  catalog.status,
  catalog.version as latestVersion,
  catalog.category,
  catalog.prefixes as catalog_prefixes,
  catalog.overview,
  catalog.release_date,
  catalog.censored,
  catalog.os,
  catalog.language,
  catalog.developer as catalog_developer,
  catalog.updated_ts as catalog_updated_ts,
  live.version AS live_version,
  live.checked_at AS live_checked_at,
  GROUP_CONCAT(tags.tag) AS tags
`;

const GAME_METADATA_JOINS = `
  FROM games
  LEFT JOIN banners ON games.record_id = banners.record_id AND banners.type = 'small'
  LEFT JOIN f95_zone_mappings ON games.record_id = f95_zone_mappings.record_id
  LEFT JOIN f95_catalog AS catalog ON f95_zone_mappings.f95_id = catalog.f95_id
  LEFT JOIN library_live_versions AS live ON games.record_id = live.record_id
  LEFT JOIN tag_mappings ON games.record_id = tag_mappings.record_id
  LEFT JOIN tags ON tag_mappings.tag_id = tags.tag_id
`;

// Values are bound as SQL parameters: they must never be escaped by hand.
// Migration 010 repairs rows that older releases stored with doubled quotes.
const addGame = (game) => {
  return new Promise((resolve, reject) => {
    const title = String(game.title || "");
    const creator = String(game.creator || "");
    const engine = String(game.engine || "");

    // Check if game already exists
    db.get(
      `SELECT record_id FROM games WHERE title = ? AND creator = ?`,
      [title, creator],
      (err, row) => {
        if (err) {
          console.error("Error checking existing game:", err);
          reject(err);
          return;
        }
        if (row) {
          // Game exists, return existing record_id
          console.log(
            `Game ${title} by ${creator} already exists with record_id: ${row.record_id}`,
          );
          resolve(row.record_id);
          return;
        }
        // Game doesn't exist, insert new record
        db.run(
          `INSERT INTO games (title, creator, engine, last_played_r, total_playtime)
           VALUES (?, ?, ?, 0, 0)`,
          [title, creator, engine],
          function (err) {
            if (err) {
              console.error("Error inserting game:", err);
              reject(err);
              return;
            }
            // Return the new record_id
            console.log(
              `Inserted new game ${title} by ${creator} with record_id: ${this.lastID}`,
            );
            resolve(this.lastID);
          },
        );
      },
    );
  });
};

const updateGame = (game) => {
  return new Promise((resolve, reject) => {
    const { record_id } = game;
    const title = String(game.title || "");
    const creator = String(game.creator || "");
    const engine = String(game.engine || "");

    if (!record_id) {
      reject(new Error("updateGame requires record_id"));
      return;
    }

    db.run(
      `UPDATE games
       SET title = ?, creator = ?, engine = ?
       WHERE record_id = ?`,
      [title, creator, engine, record_id],
      function (err) {
        if (err) {
          console.error("Error updating game:", err);
          reject(err);
          return;
        }

        if (this.changes === 0) {
          reject(new Error(`Game with record_id ${record_id} does not exist`));
          return;
        }

        resolve(record_id);
      },
    );
  });
};

const setGameFavorite = (recordId, isFavorite) => {
  const normalizedRecordId = Number(recordId);
  if (!Number.isInteger(normalizedRecordId) || normalizedRecordId <= 0) {
    return Promise.reject(new Error("setGameFavorite requires a valid recordId"));
  }

  const favoriteFlag = isFavorite ? 1 : 0;

  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE games
        SET is_favorite = ?
        WHERE record_id = ?
      `,
      [favoriteFlag, normalizedRecordId],
      function onFavoriteUpdated(err) {
        if (err) {
          console.error("Error updating game favorite flag:", err);
          reject(err);
          return;
        }

        if (this.changes === 0) {
          reject(
            new Error(`Game with record_id ${normalizedRecordId} does not exist`),
          );
          return;
        }

        resolve({
          recordId: normalizedRecordId,
          isFavorite: Boolean(favoriteFlag),
        });
      },
    );
  });
};

const addVersion = (game, recordId) => {
  const { version, folder, executables, folderSize = 0 } = game;
  const executable =
    game.selectedValue ||
    (executables && executables.length > 0 ? executables[0].value : "");
  const storedVersion = String(version || "");
  const storedFolder = String(folder || "");
  const storedExecPath = executable ? path.join(storedFolder, executable) : "";
  const dateAdded = Math.floor(Date.now() / 1000);

  console.log("adding version");
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        recordId,
        storedVersion,
        storedFolder,
        storedExecPath,
        true,
        dateAdded,
        folderSize,
      ],
      (err) => {
        if (err) {
          console.error("Error adding or updating version:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const updateVersion = (version, record_id) => {
  const storedVersion = String(version.version || "");
  const storedFolder = String(version.game_path || "");
  const storedExecPath = String(version.exec_path || "");

  console.log("updating version with id:", record_id);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO versions (record_id, version, game_path, exec_path) VALUES (?, ?, ?, ?)`,
      [record_id, storedVersion, storedFolder, storedExecPath],
      (err) => {
        if (err) {
          console.error("Error updating version:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

// Moves one version to another folder (Locate). Other columns (play time,
// size, date added) are kept. Resolves the number of changed rows.
const updateVersionLocation = (recordId, version, gamePath, execPath) =>
  new Promise((resolve, reject) => {
    db.run(
      `UPDATE versions SET game_path = ?, exec_path = ? WHERE record_id = ? AND version = ?`,
      [
        String(gamePath || ""),
        String(execPath || ""),
        recordId,
        String(version ?? ""),
      ],
      function onVersionLocationUpdated(err) {
        if (err) {
          console.error("Error updating version location:", err);
          reject(err);
          return;
        }
        resolve(this.changes || 0);
      },
    );
  });

// Stores the launcher chosen for one version. Resolves the changed rows.
const updateVersionExecutable = (recordId, version, execPath) =>
  new Promise((resolve, reject) => {
    db.run(
      `UPDATE versions SET exec_path = ? WHERE record_id = ? AND version = ?`,
      [String(execPath || ""), recordId, String(version ?? "")],
      function onVersionExecutableUpdated(err) {
        if (err) {
          console.error("Error updating version executable:", err);
          reject(err);
          return;
        }
        resolve(this.changes || 0);
      },
    );
  });

const deleteVersionsForRecordPath = (recordId, gamePath) => {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM versions WHERE record_id = ? AND game_path = ?`,
      [recordId, gamePath],
      function (err) {
        if (err) {
          console.error("Error deleting versions by game_path:", err);
          reject(err);
        } else {
          resolve(this.changes || 0);
        }
      },
    );
  });
};

const getGame = (recordId, appPaths) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT
        ${GAME_METADATA_SELECT}
      ${GAME_METADATA_JOINS}
      WHERE games.record_id = ?
      GROUP BY games.record_id
    `;
    db.get(query, [recordId], (err, row) => {
      if (err) {
        console.error("Error fetching game:", err);
        reject(err);
        return;
      }
      if (!row) {
        resolve(null);
        return;
      }
      // Fetch versions separately
      db.all(
        `SELECT version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added
         FROM versions
         WHERE record_id = ?`,
        [recordId],
        (err, versionRows) => {
          if (err) {
            console.error("Error fetching versions:", err);
            reject(err);
            return;
          }
          const versionFields = resolveLatestVersionFields(row);
          const game = {
            ...versionFields.rest,
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            isFavorite: Boolean(row.isFavorite),
            banner_url: resolveBannerUrl(
              appPaths,
              row.banner_path,
              row.remote_banner_url,
            ),
            displayTitle: buildDisplayText(row.title, row.catalog_title),
            displayCreator: buildDisplayText(row.creator, row.catalog_creator),
            catalogLatestVersion: versionFields.catalogLatestVersion,
            liveVersion: versionFields.liveVersion,
            liveCheckedAt: versionFields.liveCheckedAt,
            latestVersion: versionFields.latestVersion,
            versions: versionRows.map((v) => ({
              version: v.version,
              game_path: v.game_path,
              exec_path: v.exec_path,
              in_place: v.in_place,
              last_played: v.last_played,
              version_playtime: v.version_playtime,
              folder_size: v.folder_size,
              date_added: v.date_added,
            })),
            versionCount: versionRows.length,
          };
          const versionState = buildVersionUpdateState(
            game.latestVersion,
            game.versions,
          );
          game.isUpdateAvailable = versionState.hasUpdate;
          game.newestInstalledVersion = versionState.newestInstalledVersion;
          resolve(game);
        },
      );
    });
  });
};

const getGames = (appPaths, offset = 0, limit = null) => {
  return new Promise((resolve, reject) => {
    // Main query with OFFSET and LIMIT
    let mainQuery = `
      SELECT
        ${GAME_METADATA_SELECT}
      ${GAME_METADATA_JOINS}
      GROUP BY games.record_id
    `;
    const params = [];
    if (limit !== null) {
      mainQuery += ` LIMIT ?`;
      params.push(limit);
    }
    if (offset > 0) {
      mainQuery += ` OFFSET ?`;
      params.push(offset);
    }

    // Query to aggregate versions for each game
    const versionsQuery = `
      SELECT record_id, version, game_path, exec_path, in_place, last_played, version_playtime, folder_size, date_added
      FROM versions
    `;

    // Execute main query
    db.all(mainQuery, params, (err, rows) => {
      if (err) {
        console.error("Error fetching games:", err);
        reject(err);
        return;
      }

      // Execute versions query
      db.all(versionsQuery, [], (err, versionRows) => {
        if (err) {
          console.error("Error fetching versions:", err);
          reject(err);
          return;
        }

        // Group versions by record_id
        const versionsByRecordId = {};
        versionRows.forEach((row) => {
          if (!versionsByRecordId[row.record_id]) {
            versionsByRecordId[row.record_id] = [];
          }
          versionsByRecordId[row.record_id].push({
            version: row.version,
            game_path: row.game_path,
            exec_path: row.exec_path,
            in_place: row.in_place,
            last_played: row.last_played,
            version_playtime: row.version_playtime,
            folder_size: row.folder_size,
            date_added: row.date_added,
          });
        });

        // Map rows to include versions array and isUpdateAvailable
        const games = rows.map((row) => {
          const versions = versionsByRecordId[row.record_id] || [];
          const versionFields = resolveLatestVersionFields(row);
          const versionState = buildVersionUpdateState(
            versionFields.latestVersion,
            versions,
          );

          return {
            ...versionFields.rest,
            catalogLatestVersion: versionFields.catalogLatestVersion,
            liveVersion: versionFields.liveVersion,
            liveCheckedAt: versionFields.liveCheckedAt,
            latestVersion: versionFields.latestVersion,
            // Unescape engine to fix 'Ren''Py' issue
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            isFavorite: Boolean(row.isFavorite),
            banner_url: resolveBannerUrl(
              appPaths,
              row.banner_path,
              row.remote_banner_url,
            ),
            displayTitle: buildDisplayText(row.title, row.catalog_title),
            displayCreator: buildDisplayText(row.creator, row.catalog_creator),
            versions,
            versionCount: versions.length, // Add versionCount
            isUpdateAvailable: versionState.hasUpdate,
            newestInstalledVersion: versionState.newestInstalledVersion,
          };
        });

        console.log(`Fetched ${games.length} games with versions`);
        resolve(games);
      });
    });
  });
};

const removeGame = async (record_id) => {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM games WHERE record_id = ?", [record_id], (err) => {
      if (err) reject(err);
      else resolve({ success: true });
    });
  });
};

// Count versions for a game
const countVersions = (recordId) =>
  new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM versions WHERE record_id = ?`,
      [recordId],
      (err, row) => (err ? reject(err) : resolve(row?.count || 0)),
    );
  });

// Delete ONE specific version
const deleteVersion = (recordId, version) =>
  new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM versions WHERE record_id = ? AND version = ?`,
      [recordId, version],
      function (err) {
        err ? reject(err) : resolve({ changes: this.changes });
      },
    );
  });

// Full cleanup (images + mappings + versions + game record)
const deleteGameCompletely = async (recordId, appPaths) => {
  try {
    await deleteBanner(recordId, appPaths);
    await deletePreviews(recordId, appPaths);
    await fs
      .rm(path.join(appPaths.images, String(recordId)), {
        recursive: true,
        force: true,
      })
      .catch(() => {});

    // Foreign keys are not enforced by node-sqlite3, so dependent rows are
    // removed explicitly.
    const tables = [
      "steam_mappings",
      "f95_zone_mappings",
      "tag_mappings",
      "save_profiles",
      "save_sync_state",
      "library_live_versions",
    ];

    for (const tbl of tables) {
      await new Promise((r, j) =>
        db.run(`DELETE FROM ${tbl} WHERE record_id = ?`, [recordId], (e) =>
          e ? j(e) : r(),
        ),
      );
    }

    await new Promise((r, j) =>
      db.run(`DELETE FROM versions WHERE record_id = ?`, [recordId], (e) =>
        e ? j(e) : r(),
      ),
    );

    await new Promise((r, j) =>
      db.run(`DELETE FROM games WHERE record_id = ?`, [recordId], (e) =>
        e ? j(e) : r(),
      ),
    );

    return { success: true };
  } catch (err) {
    console.error("deleteGameCompletely failed:", err);
    return { success: false, error: err.message };
  }
};

const checkRecordExist = (title, creator, engine, version, path) => {
  return new Promise((resolve, reject) => {
    const trimmedTitle = String(title || "").trim();
    const trimmedCreator = String(creator || "").trim();
    const trimmedVersion = String(version || "").trim();
    const trimmedPath = String(path || "").trim();
    db.get(
      `SELECT g.record_id
       FROM games g
       LEFT JOIN versions v ON g.record_id = v.record_id
       WHERE (TRIM(g.title) = ? AND TRIM(g.creator) = ? AND TRIM(v.version) = ?)
       OR v.game_path = ?`,
      [trimmedTitle, trimmedCreator, trimmedVersion, trimmedPath],
      (err, row) => {
        if (err) {
          console.error("Error checking record existence:", err);
          reject(err);
        } else {
          resolve(!!row);
        }
      },
    );
  });
};

const checkPathExist = (gamePath, title) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT v.record_id FROM games g JOIN versions v ON g.record_id = v.record_id WHERE g.title = ? AND v.game_path = ?`,
      [title, gamePath],
      (err, row) => {
        if (err) reject(err);
        resolve(!!row);
      },
    );
  });
};

const upsertF95ZoneMapping = (recordId, f95Id, siteUrl = "") => {
  return new Promise((resolve, reject) => {
    if (!recordId || !f95Id) {
      reject(new Error(`Invalid input: recordId=${recordId}, f95Id=${f95Id}`));
      return;
    }

    db.run(
      `
        INSERT INTO f95_zone_mappings (record_id, f95_id, site_url)
        VALUES (?, ?, ?)
        ON CONFLICT(record_id)
        DO UPDATE SET
          f95_id = excluded.f95_id,
          site_url = excluded.site_url
      `,
      [recordId, f95Id, String(siteUrl || "").trim()],
      (err) => {
        if (err) {
          console.error("Error updating f95_zone_mappings:", err);
          reject(err);
          return;
        }

        resolve();
      },
    );
  });
};

const updateFolderSize = (recordId, version, size) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE versions SET folder_size = ? WHERE record_id = ? AND version = ?`,
      [size, recordId, version],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
};

const updateBanners = (recordId, bannerPath, type) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO banners (record_id, path, type) VALUES (?, ?, ?)`,
      [recordId, String(bannerPath || ""), String(type || "")],
      (err) => {
        if (err) {
          console.error("Error updating banners:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const updatePreviews = (recordId, previewPath) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO previews (record_id, path) VALUES (?, ?)`,
      [recordId, String(previewPath || "")],
      (err) => {
        if (err) {
          console.error("Error updating previews:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const getPreviews = (recordId, appPaths) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT path FROM previews WHERE record_id = ?`,
      [recordId],
      (err, rows) => {
        if (err) {
          console.error("Error fetching previews:", err);
          reject(err);
        } else {
          const previews = rows.map((row) =>
            toRendererPath(resolveStoredImagePath(appPaths, row.path)),
          );

          if (previews.length > 0) {
            console.log("Previews fetched for recordId:", recordId, previews);
            resolve(previews);
            return;
          }

          catalogStore
            .getCatalogEntryForRecord(db, recordId)
            .then((entry) => {
              const remotePreviews = entry ? entry.screens : [];
              console.log(
                "Remote previews fetched for recordId:",
                recordId,
                remotePreviews,
              );
              resolve(remotePreviews);
            })
            .catch((remoteErr) => {
              console.error("Error fetching remote previews:", remoteErr);
              reject(remoteErr);
            });
        }
      },
    );
  });
};

const getBanners = (recordId, appPaths) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT path FROM banners WHERE record_id = ?`,
      [recordId],
      (err, rows) => {
        if (err) {
          console.error("Error fetching banners:", err);
          reject(err);
        } else {
          const banners = rows.map((row) =>
            toRendererPath(resolveStoredImagePath(appPaths, row.path)),
          );
          console.log("Banners fetched for recordId:", recordId, banners);
          resolve(banners);
        }
      },
    );
  });
};

const getBanner = (recordId, appPaths, type) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT path FROM banners WHERE record_id = ? AND type=?`,
      [recordId, type],
      (err, rows) => {
        if (err) {
          console.error("Error fetching banners:", err);
          reject(err);
        } else {
          const banners = rows.map((row) =>
            toRendererPath(resolveStoredImagePath(appPaths, row.path)),
          );
          console.log("Banners fetched for recordId:", recordId, banners);
          resolve(banners);
        }
      },
    );
  });
};

const saveEmulatorConfig = (emulator) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO emulators (extension, program_path, parameters) VALUES (?, ?, ?)`,
      [emulator.extension, emulator.program_path, emulator.parameters || ""],
      (err) => {
        if (err) {
          console.error("Error saving emulator config:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
};

const getEmulatorConfig = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT extension, program_path, parameters FROM emulators`,
      [],
      (err, rows) => {
        if (err) {
          console.error("Error fetching emulator config:", err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      },
    );
  });
};

const removeEmulatorConfig = (extension) => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM emulators WHERE extension = ?`, [extension], (err) => {
      if (err) {
        console.error("Error removing emulator config:", err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const deleteBanner = (recordId, appPaths) => {
  return new Promise(async (resolve, reject) => {
    try {
      const banners = await getBanners(recordId, appPaths);
      for (const banner_path of banners) {
        const filePath = banner_path.replace("file://", ""); // Adjust to data/images
        console.log("Attempting to delete preview file:", filePath);
        try {
          if (
            await fs
              .access(filePath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fs.unlink(filePath);
            console.log("Deleted preview file:", filePath);
          } else {
            console.log("Preview file does not exist:", filePath);
          }
        } catch (fileErr) {
          console.error("Error deleting preview file:", fileErr);
          // Continue with next file
        }
      }
      db.run(`DELETE FROM banners WHERE record_id = ?`, [recordId], (err) => {
        if (err) {
          console.error("Error removing banners from database:", err);
          reject(err);
        } else {
          console.log("banners removed from database for recordId:", recordId);
          resolve();
        }
      });
    } catch (err) {
      console.error("Error deleting banners:", err);
      reject(err);
    }
  });
};

const deletePreviews = (recordId, appPaths) => {
  return new Promise(async (resolve, reject) => {
    try {
      const previews = await getPreviews(recordId, appPaths);
      for (const previewUrl of previews) {
        const filePath = previewUrl.replace("file://", ""); // Adjust to data/images
        console.log("Attempting to delete preview file:", filePath);
        try {
          if (
            await fs
              .access(filePath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fs.unlink(filePath);
            console.log("Deleted preview file:", filePath);
          } else {
            console.log("Preview file does not exist:", filePath);
          }
        } catch (fileErr) {
          console.error("Error deleting preview file:", fileErr);
          // Continue with next file
        }
      }
      db.run(`DELETE FROM previews WHERE record_id = ?`, [recordId], (err) => {
        if (err) {
          console.error("Error removing previews from database:", err);
          reject(err);
        } else {
          console.log("Previews removed from database for recordId:", recordId);
          resolve();
        }
      });
    } catch (err) {
      console.error("Error deleting previews:", err);
      reject(err);
    }
  });
};

const getEmulatorByExtension = (extension) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM emulators WHERE extension = ?`,
      [extension],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      },
    );
  });
};

//STEAM SPECIFIC FUNCTIONS
const getSteamIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT steam_id FROM steam_mappings WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.steam_id : null);
      },
    );
  });
};

const addSteamMapping = (recordId, steamId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO steam_mappings (record_id, steam_id) VALUES (?, ?)`,
      [recordId, steamId],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
};

const getSteamBannerUrl = (steamId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT header FROM steam_data WHERE steam_id = ?`,
      [steamId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.header : null);
      },
    );
  });
};

const getSteamScreensUrlList = (steamId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT screen_url FROM steam_screens WHERE steam_id = ?`,
      [steamId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map((row) => row.screen_url));
      },
    );
  });
};

// ─── Metadata catalog (f95_catalog, see main/catalog) ───────────────────

const getCatalogEntry = (f95Id) => catalogStore.getCatalogEntry(db, f95Id);

const getCatalogEntryForRecord = (recordId) =>
  catalogStore.getCatalogEntryForRecord(db, recordId);

const getF95IdForRecord = (recordId) => catalogStore.getF95IdForRecord(db, recordId);

const searchCatalog = (title, creator, options = {}) =>
  catalogStore.searchCatalogEntries(db, {
    title,
    creator,
    limit: options.limit,
  });

const getCatalogFilterOptions = () => catalogStore.getCatalogFilterOptions(db);

const getCatalogSyncState = () => catalogStore.getCatalogSyncState(db);

const saveCatalogThreadDetails = (f95Id, details) =>
  catalogStore.setCatalogThreadDetails(db, f95Id, details);

/**
 * One catalog entry in the shape the site search and its result cards use.
 * @param {import("./main/db/f95CatalogStore").StoredCatalogEntry} entry
 * @param {number | null} libraryRecordId
 */
const toSiteCatalogResult = (entry, libraryRecordId) => ({
  f95Id: entry.f95Id,
  title: entry.title,
  creator: entry.creator,
  engine: entry.engine,
  version: entry.version,
  category: entry.category,
  status: entry.status,
  prefixes: entry.prefixes,
  overview: entry.overview,
  updatedTs: entry.updatedTs,
  releaseDate: entry.releaseDate || entry.updatedTs,
  censored: entry.censored,
  os: entry.os,
  language: entry.language,
  developer: entry.developer,
  bannerUrl: entry.coverUrl || null,
  screens: entry.screens,
  siteUrl: entry.siteUrl || null,
  views: entry.views,
  likes: entry.likes,
  rating: entry.rating,
  tags: entry.tags.join(", "),
  tagList: entry.tags,
  libraryRecordId,
  isInstalled: Boolean(libraryRecordId),
});

const searchSiteCatalog = async (filters = {}, options = {}) => {
  const limit = Math.max(1, Number(options.limit) || 120);
  const [entries, mappings] = await Promise.all([
    catalogStore.listCatalogEntries(db),
    new Promise((resolve, reject) => {
      db.all("SELECT record_id, f95_id FROM f95_zone_mappings", [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    }),
  ]);
  const recordByF95Id = new Map();
  for (const row of mappings) {
    const f95Id = Number(row.f95_id);
    if (Number.isInteger(f95Id) && f95Id > 0 && !recordByF95Id.has(f95Id)) {
      recordByF95Id.set(f95Id, Number(row.record_id));
    }
  }
  const results = entries.map((entry) =>
    toSiteCatalogResult(entry, recordByF95Id.get(entry.f95Id) || null),
  );
  const filteredEntries = filterSiteCatalogEntries(results, filters);
  return {
    results: filteredEntries.slice(0, limit),
    total: filteredEntries.length,
    limit,
    limited: filteredEntries.length > limit,
  };
};

module.exports = {
  initializeDatabase,
  addGame,
  addVersion,
  getGames,
  removeGame,
  searchSiteCatalog,
  searchCatalog,
  getCatalogEntry,
  getCatalogEntryForRecord,
  getF95IdForRecord,
  getCatalogFilterOptions,
  getCatalogSyncState,
  saveCatalogThreadDetails,
  checkRecordExist,
  checkPathExist,
  upsertF95ZoneMapping,
  updateFolderSize,
  updateBanners,
  updatePreviews,
  getGame,
  saveEmulatorConfig,
  getEmulatorConfig,
  removeEmulatorConfig,
  getEmulatorByExtension,
  getPreviews,
  deleteBanner,
  deletePreviews,
  getBanners,
  getBanner,
  updateGame,
  setGameFavorite,
  updateVersion,
  updateVersionLocation,
  updateVersionExecutable,
  deleteVersionsForRecordPath,
  getSteamIDbyRecord,
  addSteamMapping,
  getSteamBannerUrl,
  getSteamScreensUrlList,
  countVersions,
  deleteVersion,
  deleteGameCompletely,
  db, // Export db instance (undefined until initializeDatabase; prefer getDb)
  getDb,
};
