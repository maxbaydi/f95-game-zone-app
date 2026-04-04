const { getGame } = require("../database");
const { detectRenpySaveProfiles } = require("./detectors/renpySaveDetector");
const {
  getSaveProfiles,
  replaceSaveProfiles,
} = require("./db/saveProfilesStore");
const {
  getSaveSyncState,
  upsertSaveSyncState,
} = require("./db/saveSyncStateStore");
const { buildSaveVaultIdentity } = require("./saveVault");

function getPrimaryInstallPath(game) {
  const versions = Array.isArray(game?.versions) ? [...game.versions] : [];
  versions.sort((left, right) => (right.date_added || 0) - (left.date_added || 0));

  for (const version of versions) {
    if (version?.game_path) {
      return version.game_path;
    }
  }

  return "";
}

async function refreshSaveProfiles(appPaths, db, recordId) {
  const game = await getGame(recordId, appPaths);
  if (!game) {
    return {
      game: null,
      profiles: [],
      syncState: null,
    };
  }

  const detectedProfiles = detectRenpySaveProfiles({
    ...game,
    primaryPath: getPrimaryInstallPath(game),
  });
  const storedProfiles = await replaceSaveProfiles(db, recordId, detectedProfiles);
  const cloudIdentity = buildSaveVaultIdentity({
    threadUrl: game?.siteUrl || "",
    atlasId: game?.atlas_id || "",
    title: game?.displayTitle || game?.title || "",
    creator: game?.displayCreator || game?.creator || "",
  });
  const syncState =
    (await getSaveSyncState(db, recordId)) ||
    (await upsertSaveSyncState(db, {
      recordId,
      cloudIdentity,
      syncStatus: "idle",
    }));

  return {
    game,
    profiles: storedProfiles,
    syncState,
  };
}

async function getSaveProfileSnapshot(appPaths, db, recordId) {
  const game = await getGame(recordId, appPaths);
  if (!game) {
    return {
      game: null,
      profiles: [],
      syncState: null,
    };
  }

  const profiles = await getSaveProfiles(db, recordId);
  const cloudIdentity = buildSaveVaultIdentity({
    threadUrl: game?.siteUrl || "",
    atlasId: game?.atlas_id || "",
    title: game?.displayTitle || game?.title || "",
    creator: game?.displayCreator || game?.creator || "",
  });
  const syncState =
    (await getSaveSyncState(db, recordId)) ||
    (await upsertSaveSyncState(db, {
      recordId,
      cloudIdentity,
      syncStatus: "idle",
    }));

  if (profiles.length > 0) {
    return {
      game,
      profiles,
      syncState,
    };
  }

  return refreshSaveProfiles(appPaths, db, recordId);
}

module.exports = {
  getPrimaryInstallPath,
  getSaveProfileSnapshot,
  refreshSaveProfiles,
};
