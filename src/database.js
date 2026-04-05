// @ts-nocheck

const path = require("path");
const fs = require("fs").promises;
const { resolveStoredImagePath, toRendererPath } = require("./main/assetPaths");
const { openDatabase } = require("./main/db/openDatabase");
const {
  splitDelimitedText,
  filterSiteCatalogEntries,
} = require("./shared/siteSearch");
const { buildVersionUpdateState } = require("./shared/versionUpdate");

let db;

const initializeDatabase = (dataDirOrPaths, options = {}) => {
  return openDatabase(dataDirOrPaths, options).then((database) => {
    db = database;
    return db;
  });
};

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

const GAME_METADATA_SELECT = `
  games.record_id as record_id,
  atlas_mappings.atlas_id as atlas_id,
  games.title as title,
  games.creator as creator,
  games.engine as engine,
  games.description,
  games.total_playtime,
  games.last_played_r,
  games.last_played_version,
  banners.path as banner_path,
  COALESCE(f95_thread_data.banner_url, f95_atlas_data.banner_url) as remote_banner_url,
  COALESCE(f95_thread_data.f95_id, f95_atlas_data.f95_id, f95_zone_mappings.f95_id) as f95_id,
  COALESCE(
    NULLIF(f95_thread_data.site_url, ''),
    NULLIF(f95_zone_mappings.site_url, ''),
    f95_atlas_data.site_url
  ) as siteUrl,
  COALESCE(f95_thread_data.views, f95_atlas_data.views) as views,
  COALESCE(f95_thread_data.likes, f95_atlas_data.likes) as likes,
  COALESCE(f95_thread_data.tags, f95_atlas_data.tags) as f95_tags,
  COALESCE(f95_thread_data.rating, f95_atlas_data.rating) as rating,
  atlas_data.title as atlas_title,
  atlas_data.creator as atlas_creator,
  atlas_data.status,
  atlas_data.version as latestVersion,
  atlas_data.category,
  atlas_data.censored,
  atlas_data.genre,
  atlas_data.language,
  atlas_data.os,
  atlas_data.overview,
  atlas_data.translations,
  atlas_data.release_date,
  atlas_data.voice,
  atlas_data.short_name,
  GROUP_CONCAT(tags.tag) AS tags
`;

const GAME_METADATA_JOINS = `
  FROM games
  LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
  LEFT JOIN banners ON games.record_id = banners.record_id AND banners.type = 'small'
  LEFT JOIN f95_zone_mappings ON games.record_id = f95_zone_mappings.record_id
  LEFT JOIN f95_zone_data AS f95_atlas_data ON atlas_mappings.atlas_id = f95_atlas_data.atlas_id
  LEFT JOIN f95_zone_data AS f95_thread_data ON f95_zone_mappings.f95_id = f95_thread_data.f95_id
  LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
  LEFT JOIN tag_mappings ON games.record_id = tag_mappings.record_id
  LEFT JOIN tags ON tag_mappings.tag_id = tags.tag_id
`;

const addGame = (game) => {
  return new Promise((resolve, reject) => {
    const { title, creator, engine } = game;
    const escapedTitle = title.replace(/'/g, "''");
    const escapedCreator = creator.replace(/'/g, "''");
    const escapedEngine = engine.replace(/'/g, "''");

    // Check if game already exists
    db.get(
      `SELECT record_id FROM games WHERE title = ? AND creator = ?`,
      [escapedTitle, escapedCreator],
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
          [escapedTitle, escapedCreator, escapedEngine],
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
    const { record_id, title, creator, engine } = game;
    const escapedTitle = title.replace(/'/g, "''");
    const escapedCreator = creator.replace(/'/g, "''");
    const escapedEngine = engine.replace(/'/g, "''");

    if (!record_id) {
      reject(new Error("updateGame requires record_id"));
      return;
    }

    db.run(
      `UPDATE games
       SET title = ?, creator = ?, engine = ?
       WHERE record_id = ?`,
      [escapedTitle, escapedCreator, escapedEngine, record_id],
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

const addVersion = (game, recordId) => {
  const { version, folder, executables, folderSize = 0 } = game;
  const executable =
    game.selectedValue ||
    (executables && executables.length > 0 ? executables[0].value : "");
  const escapedVersion = version.replace(/'/g, "''");
  const escapedFolder = folder.replace(/'/g, "''");
  const escapedExecPath = executable
    ? path.join(folder, executable).replace(/'/g, "''")
    : "";
  const dateAdded = Math.floor(Date.now() / 1000);

  console.log("adding version");
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO versions (record_id, version, game_path, exec_path, in_place, date_added, last_played, version_playtime, folder_size) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        recordId,
        escapedVersion,
        escapedFolder,
        escapedExecPath,
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
  const escapedVersion = version.version.replace(/'/g, "''");
  const escapedFolder = version.game_path.replace(/'/g, "''");
  const escapedExecPath = version.exec_path.replace(/'/g, "''");

  console.log("updating version with id:", record_id);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO versions (record_id, version, game_path, exec_path) VALUES (?, ?, ?, ?)`,
      [record_id, escapedVersion, escapedFolder, escapedExecPath],
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
          const game = {
            ...row,
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            banner_url: resolveBannerUrl(
              appPaths,
              row.banner_path,
              row.remote_banner_url,
            ),
            displayTitle: buildDisplayText(row.title, row.atlas_title),
            displayCreator: buildDisplayText(row.creator, row.atlas_creator),
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
            row.latestVersion,
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
          const versionState = buildVersionUpdateState(
            row.latestVersion,
            versions,
          );

          return {
            ...row,
            // Unescape engine to fix 'Ren''Py' issue
            engine: row.engine ? row.engine.replace(/''/g, "'") : row.engine,
            banner_url: resolveBannerUrl(
              appPaths,
              row.banner_path,
              row.remote_banner_url,
            ),
            displayTitle: buildDisplayText(row.title, row.atlas_title),
            displayCreator: buildDisplayText(row.creator, row.atlas_creator),
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

    const tables = [
      "atlas_mappings",
      "steam_mappings",
      "f95_zone_mappings",
      "tag_mappings",
      "save_profiles",
      "save_sync_state",
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

const checkDbUpdates = async (updatesDir, mainWindow) => {
  const axios = require("axios");
  const fs = require("fs");
  const lz4 = require("lz4js");

  try {
    const url = "https://atlas-gamesdb.com/api/updates";
    const response = await axios.get(url);
    const updates = response.data;
    if (!Array.isArray(updates)) throw new Error("Invalid updates data");

    // Get last update version
    const lastUpdateVersion = await new Promise((resolve, reject) => {
      db.get(
        "SELECT MAX(update_time) as last_update FROM updates",
        [],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.last_update ? parseInt(row.last_update) : 0);
        },
      );
    });

    // Filter updates newer than lastUpdateVersion
    const newUpdates = updates.filter(
      (update) =>
        parseInt(update.date) > lastUpdateVersion || lastUpdateVersion === 0,
    );
    const total = newUpdates.length;

    if (total === 0) {
      return {
        success: true,
        message: "No new updates available",
        total: 0,
        processed: 0,
      };
    }

    let processed = 0;
    for (const update of newUpdates.reverse()) {
      const { date, name, md5 } = update;
      const downloadUrl = `https://atlas-gamesdb.com/packages/${name}`;
      const outputPath = path.join(updatesDir, name);

      // Download update
      mainWindow.webContents.send("db-update-progress", {
        text: `Downloading Database Update ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
      });
      fs.writeFileSync(outputPath, response.data);

      // Decompress LZ4
      const compressedData = fs.readFileSync(outputPath);
      const decompressedData = Buffer.from(lz4.decompress(compressedData));
      const data = JSON.parse(decompressedData.toString("utf8"));
      // Process atlas_data
      mainWindow.webContents.send("db-update-progress", {
        text: `Processing Atlas Metadata ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      if (data.atlas && data.atlas.length > 0) {
        await insertJsonData(data.atlas, "atlas_data");
      }

      // Process f95_zone_data
      mainWindow.webContents.send("db-update-progress", {
        text: `Processing F95 Metadata ${processed + 1}/${total}`,
        progress: processed,
        total,
      });
      if (data.f95_zone && data.f95_zone.length > 0) {
        await insertJsonData(data.f95_zone, "f95_zone_data");
      }

      // Insert update record
      const processedTime = Math.floor(Date.now() / 1000);
      await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO updates (update_time, processed_time, md5) VALUES (?, ?, ?)",
          [date, processedTime, md5],
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      processed++;
      mainWindow.webContents.send("db-update-progress", {
        text: `Processed Update ${processed}/${total}`,
        progress: processed,
        total,
      });
    }

    return {
      success: true,
      message: `Processed ${processed} updates`,
      total,
      processed,
    };
  } catch (err) {
    console.error("Error checking database updates:", err);
    return { success: false, error: err.message, total: 0, processed: 0 };
  }
};

const searchAtlas = async (title, creator) => {
  const queries = [
    async () => {
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT atlas_id, title, creator, engine FROM atlas_data WHERE title LIKE ? AND creator LIKE ?`,
          [`%${title}%`, `%${creator}%`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          },
        );
      });
    },
    async () => {
      const shortName = title.replace(/[\W_]+/g, "").toUpperCase();
      const queryTitle = `
        SELECT
          atlas_id,
          title,
          creator,
          engine,
          LENGTH(short_name) - LENGTH(?) as difference
        FROM atlas_data
        WHERE short_name LIKE ?
        ORDER BY LENGTH(short_name) - LENGTH(?)
      `;
      return new Promise((resolve, reject) => {
        db.all(
          queryTitle,
          [shortName, `%${shortName}%`, shortName],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          },
        );
      });
    },
    async () => {
      const fullName = `${title}${creator}`
        .replace(/[\W_]+/g, "")
        .toUpperCase();
      const queryFull = `
        WITH data_0 AS (
          SELECT
            atlas_id,
            title,
            creator,
            engine,
            UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              title || '' || creator,
              '-', ''), '_', ''), '/', ''), '\\', ''), ':', ''), ';', ''), '''', ''), ' ', ''), '.', '')) as full_name
          FROM atlas_data
        )
        SELECT
          atlas_id,
          title,
          creator,
          engine,
          LENGTH(full_name) - LENGTH(?) as difference
        FROM data_0
        WHERE full_name LIKE ?
        ORDER BY LENGTH(full_name) - LENGTH(?)
      `;
      return new Promise((resolve, reject) => {
        db.all(
          queryFull,
          [fullName, `%${fullName}%`, fullName],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          },
        );
      });
    },
    async () => {
      // Title-only search
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT atlas_id, title, creator, engine FROM atlas_data WHERE title LIKE ?`,
          [`%${title}%`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          },
        );
      });
    },
  ];

  const allResults = new Map(); // Use Map to store unique results by atlas_id

  for (const queryFn of queries) {
    try {
      const rows = await queryFn();
      console.log(`Query returned ${rows.length} results`);
      let hasF95Id = false;
      const enrichedRows = [];
      for (const row of rows) {
        const f95Id = await findF95Id(row.atlas_id);
        if (f95Id) {
          hasF95Id = true;
        }
        if (!allResults.has(row.atlas_id)) {
          allResults.set(row.atlas_id, { ...row, f95_id: f95Id || "" });
        }
        enrichedRows.push({ ...row, f95_id: f95Id || "" });
      }
      if (hasF95Id) {
        // Return results from this query if any have f95_id
        const filteredRows = enrichedRows.filter((row) => Boolean(row.f95_id));
        console.log(`Query found ${filteredRows.length} results with f95_id`);
        return filteredRows.length > 0 ? filteredRows : enrichedRows;
      }
    } catch (err) {
      console.error("Error in searchAtlas query:", err);
    }
  }

  // If no results with f95_id, return all unique results from all queries
  const finalResults = Array.from(allResults.values());
  console.log(
    `Returning ${finalResults.length} unique results from all queries`,
  );
  return finalResults;
};

const searchSiteCatalog = (filters = {}, options = {}) => {
  const limit = Math.max(1, Number(options.limit) || 120);

  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT
          atlas_data.atlas_id as atlas_id,
          f95_zone_data.f95_id as f95_id,
          atlas_data.title as title,
          atlas_data.creator as creator,
          atlas_data.engine as engine,
          atlas_data.version as version,
          atlas_data.category as category,
          atlas_data.status as status,
          atlas_data.censored as censored,
          atlas_data.language as language,
          atlas_data.genre as genre,
          atlas_data.voice as voice,
          atlas_data.os as os,
          atlas_data.overview as overview,
          atlas_data.release_date as release_date,
          atlas_data.banner as atlas_banner,
          atlas_data.banner_wide as atlas_banner_wide,
          atlas_data.cover as atlas_cover,
          atlas_data.tags as atlas_tags,
          f95_zone_data.banner_url as banner_url,
          f95_zone_data.site_url as site_url,
          f95_zone_data.thread_publish_date as thread_publish_date,
          f95_zone_data.last_thread_comment as last_thread_comment,
          f95_zone_data.views as views,
          f95_zone_data.likes as likes,
          f95_zone_data.rating as rating,
          f95_zone_data.replies as replies,
          f95_zone_data.tags as f95_tags,
          games.record_id as library_record_id
        FROM atlas_data
        LEFT JOIN f95_zone_data ON atlas_data.atlas_id = f95_zone_data.atlas_id
        LEFT JOIN atlas_mappings ON atlas_data.atlas_id = atlas_mappings.atlas_id
        LEFT JOIN games ON atlas_mappings.record_id = games.record_id
      `,
      [],
      (err, rows) => {
        if (err) {
          console.error("Error searching site catalog:", err);
          reject(err);
          return;
        }

        const entries = rows.map((row) => ({
          atlasId: row.atlas_id,
          f95Id: row.f95_id,
          title: row.title || "",
          creator: row.creator || "",
          engine: row.engine || "",
          version: row.version || "",
          category: row.category || "",
          status: row.status || "",
          censored: row.censored || "",
          language: row.language || "",
          genre: row.genre || "",
          voice: row.voice || "",
          os: row.os || "",
          overview: row.overview || "",
          releaseDate: row.release_date || 0,
          bannerUrl:
            row.banner_url ||
            row.atlas_banner_wide ||
            row.atlas_banner ||
            row.atlas_cover ||
            null,
          siteUrl: row.site_url || null,
          threadPublishDate: row.thread_publish_date || null,
          lastThreadComment: row.last_thread_comment || null,
          views: row.views || "0",
          likes: row.likes || "0",
          rating: row.rating || "0",
          replies: row.replies || "0",
          tags: row.f95_tags || row.atlas_tags || "",
          tagList: splitDelimitedText(row.f95_tags || row.atlas_tags || ""),
          libraryRecordId: row.library_record_id || null,
          isInstalled: Boolean(row.library_record_id),
        }));

        const filteredEntries = filterSiteCatalogEntries(entries, filters);
        resolve({
          results: filteredEntries.slice(0, limit),
          total: filteredEntries.length,
          limit,
          limited: filteredEntries.length > limit,
        });
      },
    );
  });
};

const findF95Id = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT f95_id FROM f95_zone_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.f95_id : null);
      },
    );
  });
};

const GetAtlasIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT atlas_id FROM atlas_mappings WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.atlas_id : null);
      },
    );
  });
};

const checkRecordExist = (title, creator, engine, version, path) => {
  return new Promise((resolve, reject) => {
    const escapedTitle = title.trim().replace(/'/g, "''");
    const escapedCreator = creator.trim().replace(/'/g, "''");
    const escapedVersion = version.trim().replace(/'/g, "''");
    const escapedVPath = path.trim().replace(/'/g, "''");
    db.get(
      `SELECT g.record_id
       FROM games g
       LEFT JOIN versions v ON g.record_id = v.record_id
       WHERE TRIM(g.title) = ? AND TRIM(g.creator) = ? AND TRIM(v.version) = ?
       OR v.game_path = ?`,
      [escapedTitle, escapedCreator, escapedVersion, escapedVPath],
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

const addAtlasMapping = (recordId, atlasId) => {
  return new Promise((resolve, reject) => {
    console.log("Updating Atlas Mapping");
    // Validate inputs
    if (!recordId || !atlasId) {
      const error = new Error(
        `Invalid input: recordId=${recordId}, atlasId=${atlasId}`,
      );
      console.error("addAtlasMapping error:", error.message);
      return reject(error);
    }

    // Check if record_id exists in games
    db.get(
      `SELECT record_id FROM games WHERE record_id = ?`,
      [recordId],
      (err, row) => {
        if (err) {
          console.error("Error checking games table:", err);
          return reject(err);
        }
        if (!row) {
          const error = new Error(
            `record_id ${recordId} does not exist in games table`,
          );
          console.error("addAtlasMapping error:", error.message);
          return reject(error);
        }

        // Check if atlas_id exists in atlas_data
        db.get(
          `SELECT atlas_id FROM atlas_data WHERE atlas_id = ?`,
          [atlasId],
          (err, row) => {
            if (err) {
              console.error("Error checking atlas_data table:", err);
              return reject(err);
            }
            if (!row) {
              const error = new Error(
                `atlas_id ${atlasId} does not exist in atlas_data table`,
              );
              console.error("addAtlasMapping error:", error.message);
              return reject(error);
            }

            // Insert or ignore mapping
            db.run(
              `INSERT OR REPLACE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)`,
              [recordId, atlasId],
              (err) => {
                if (err) {
                  console.error("Error inserting into atlas_mappings:", err);
                  reject(err);
                } else {
                  resolve();
                }
              },
            );
          },
        );
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

const getBannerUrl = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT banner_url FROM f95_zone_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) {
          console.error("Error fetching banner_url:", err);
          reject(err);
        } else {
          resolve(row ? row.banner_url : "");
        }
      },
    );
  });
};

const getScreensUrlList = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT screens FROM f95_zone_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) {
          console.error("Error fetching screens:", err);
          reject(err);
        } else {
          const screens =
            row && row.screens
              ? row.screens.split(",").map((s) => s.trim())
              : [];
          resolve(screens);
        }
      },
    );
  });
};

const updateBanners = (recordId, bannerPath, type) => {
  return new Promise((resolve, reject) => {
    const escapedPath = bannerPath.replace(/'/g, "''");
    const escapedType = type.replace(/'/g, "''");
    db.run(
      `INSERT OR REPLACE INTO banners (record_id, path, type) VALUES (?, ?, ?)`,
      [recordId, escapedPath, escapedType],
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
    const escapedPath = previewPath.replace(/'/g, "''");
    db.run(
      `INSERT OR REPLACE INTO previews (record_id, path) VALUES (?, ?)`,
      [recordId, escapedPath],
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

          db.get(
            `
              SELECT f95_zone_data.screens as screens
              FROM atlas_mappings
              JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
              WHERE atlas_mappings.record_id = ?
            `,
            [recordId],
            (remoteErr, remoteRow) => {
              if (remoteErr) {
                console.error("Error fetching remote previews:", remoteErr);
                reject(remoteErr);
                return;
              }

              const remotePreviews =
                remoteRow?.screens
                  ?.split(",")
                  .map((screen) => screen.trim())
                  .filter(Boolean) || [];
              console.log(
                "Remote previews fetched for recordId:",
                recordId,
                remotePreviews,
              );
              resolve(remotePreviews);
            },
          );
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

const getAtlasData = (atlasId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT title, creator, engine, version FROM atlas_data WHERE atlas_id = ?`,
      [atlasId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      },
    );
  });
};

const insertJsonData = async (jsonData, tableName) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (${Object.keys(jsonData[0]).join(", ")}) VALUES (${Object.keys(
          jsonData[0],
        )
          .map(() => "?")
          .join(", ")})`,
      );
      for (const item of jsonData) {
        stmt.run(Object.values(item), (err) => {
          if (err) {
            db.run("ROLLBACK");
            reject(err);
          }
        });
      }
      stmt.finalize((err) => {
        if (err) {
          db.run("ROLLBACK");
          reject(err);
        } else {
          db.run("COMMIT", (err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });
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

const searchAtlasByF95Id = (f95Id) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT a.atlas_id, f.f95_id, a.title, a.creator, a.engine FROM atlas_data a
        LEFT JOIN f95_zone_data f ON a.atlas_id = f.atlas_id WHERE f.f95_id =?`,
      [f95Id],
      (err, rows) => {
        if (err) {
          console.error(`Error querying atlas_data for f95_id ${f95Id}:`, err);
          reject(err);
        } else {
          console.log(`Found ${rows.length} results for f95_id ${f95Id}`);
          resolve(rows || []);
        }
      },
    );
  });
};

const getUniqueFilterOptions = () => {
  return new Promise((resolve, reject) => {
    const options = {};

    db.all(
      "SELECT DISTINCT category FROM atlas_data WHERE category IS NOT NULL",
      [],
      (err, rows) => {
        if (err) return reject(err);
        options.categories = rows.map((r) => r.category);

        db.all(
          "SELECT DISTINCT engine FROM atlas_data WHERE engine IS NOT NULL",
          [],
          (err, rows) => {
            if (err) return reject(err);
            options.engines = rows.map((r) => r.engine);

            db.all(
              "SELECT DISTINCT status FROM atlas_data WHERE status IS NOT NULL",
              [],
              (err, rows) => {
                if (err) return reject(err);
                options.statuses = rows.map((r) => r.status);

                db.all(
                  "SELECT DISTINCT censored FROM atlas_data WHERE censored IS NOT NULL",
                  [],
                  (err, rows) => {
                    if (err) return reject(err);
                    options.censored = rows.map((r) => r.censored);

                    db.all(
                      "SELECT DISTINCT language FROM atlas_data WHERE language IS NOT NULL",
                      [],
                      (err, rows) => {
                        if (err) return reject(err);
                        options.languages = Array.from(
                          new Set(
                            rows.flatMap((row) =>
                              splitDelimitedText(row.language),
                            ),
                          ),
                        );

                        // Tags from f95_zone_data
                        db.all(
                          "SELECT tags FROM f95_zone_data WHERE tags IS NOT NULL",
                          [],
                          (err, rows) => {
                            if (err) return reject(err);
                            const tagsSet = new Set();
                            rows.forEach((row) => {
                              splitDelimitedText(row.tags).forEach((tag) =>
                                tagsSet.add(tag),
                              );
                            });
                            options.tags = Array.from(tagsSet);

                            resolve(options);
                          },
                        );
                      },
                    );
                  },
                );
              },
            );
          },
        );
      },
    );
  });
};

module.exports = {
  initializeDatabase,
  addGame,
  addVersion,
  getGames,
  removeGame,
  checkDbUpdates,
  insertJsonData,
  searchAtlas,
  searchSiteCatalog,
  findF95Id,
  checkRecordExist,
  checkPathExist,
  addAtlasMapping,
  upsertF95ZoneMapping,
  updateFolderSize,
  getBannerUrl,
  getScreensUrlList,
  updateBanners,
  updatePreviews,
  getAtlasData,
  getGame,
  saveEmulatorConfig,
  getEmulatorConfig,
  removeEmulatorConfig,
  getEmulatorByExtension,
  GetAtlasIDbyRecord,
  getPreviews,
  deleteBanner,
  deletePreviews,
  getBanners,
  getBanner,
  updateGame,
  updateVersion,
  deleteVersionsForRecordPath,
  getSteamIDbyRecord,
  addSteamMapping,
  getSteamBannerUrl,
  getSteamScreensUrlList,
  searchAtlasByF95Id,
  countVersions,
  deleteVersion,
  deleteGameCompletely,
  getUniqueFilterOptions,
  db, // Export db instance
};
