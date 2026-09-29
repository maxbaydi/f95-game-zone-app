// @ts-check

/**
 * Finds folders that a desktop cloud client already keeps in sync on this
 * computer (OneDrive, Dropbox, Google Drive, Yandex.Disk, iCloud, MEGA,
 * pCloud, Nextcloud, Box, Proton Drive, Syncthing ...). Choosing one of them
 * gives cloud save sync with zero credentials: the client does the upload.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SAVE_STORAGE_SUBFOLDER = "F95Launcher Saves";

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   path: string,
 *   suggestedPath: string,
 *   reason: string,
 *   recommended: boolean,
 *   source: "env" | "client-config" | "well-known" | "drive-letter",
 * }} DetectedCloudFolder
 */

/**
 * @param {string} candidate
 * @param {{ existsSync?: typeof fs.existsSync, statSync?: typeof fs.statSync }} deps
 */
function isDirectory(candidate, deps) {
  if (!candidate) {
    return false;
  }
  try {
    if (deps.existsSync && !deps.existsSync(candidate)) {
      return false;
    }
    return (deps.statSync || fs.statSync)(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Dropbox writes its sync folder to info.json.
 * @param {Record<string, string | undefined>} env
 * @param {{ readFileSync?: typeof fs.readFileSync }} deps
 */
function readDropboxPaths(env, deps) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const candidates = [
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Dropbox", "info.json") : "",
    env.APPDATA ? path.join(env.APPDATA, "Dropbox", "info.json") : "",
    env.HOME ? path.join(env.HOME, ".dropbox", "info.json") : "",
  ].filter(Boolean);
  const found = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      for (const [account, info] of Object.entries(parsed || {})) {
        if (info && typeof info === "object" && typeof (/** @type {any} */ (info)).path === "string") {
          found.push({ account, path: (/** @type {any} */ (info)).path });
        }
      }
    } catch {
      // Not installed or unreadable.
    }
  }
  return found;
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   homeDir?: string,
 *   platform?: NodeJS.Platform,
 *   existsSync?: typeof fs.existsSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   readdirSync?: typeof fs.readdirSync,
 *   driveLetters?: string[],
 * }=} deps
 * @returns {DetectedCloudFolder[]}
 */
function detectCloudSyncFolders(deps = {}) {
  const env = deps.env || process.env;
  const home = deps.homeDir || env.USERPROFILE || env.HOME || os.homedir();
  const platform = deps.platform || process.platform;
  /** @type {DetectedCloudFolder[]} */
  const found = [];
  const seen = new Set();

  const add = (entry) => {
    const key = path.resolve(entry.path).toLowerCase();
    if (!entry.path || seen.has(key) || !isDirectory(entry.path, deps)) {
      return;
    }
    seen.add(key);
    found.push({
      ...entry,
      suggestedPath: path.join(entry.path, SAVE_STORAGE_SUBFOLDER),
    });
  };

  // OneDrive: Windows exports the folder(s) as environment variables.
  for (const [variable, label] of [
    ["OneDriveConsumer", "OneDrive"],
    ["OneDriveCommercial", "OneDrive (work or school)"],
    ["OneDrive", "OneDrive"],
  ]) {
    if (env[variable]) {
      add({
        id: "onedrive",
        label,
        path: String(env[variable]),
        reason: "Signed-in OneDrive client on this PC. Windows backs it up automatically.",
        recommended: true,
        source: "env",
      });
    }
  }

  // Dropbox: info.json names the folder.
  for (const entry of readDropboxPaths(env, deps)) {
    add({
      id: "dropbox",
      label: entry.account === "business" ? "Dropbox (business)" : "Dropbox",
      path: entry.path,
      reason: "Dropbox client on this PC.",
      recommended: true,
      source: "client-config",
    });
  }

  // Google Drive for desktop mounts a drive letter with "My Drive".
  if (platform === "win32") {
    const letters = deps.driveLetters || "DEFGHIJKLMNOPQRSTUVWXYZ".split("");
    for (const letter of letters) {
      const myDrive = `${letter}:\\My Drive`;
      const myDriveRu = `${letter}:\\Мой диск`;
      for (const candidate of [myDrive, myDriveRu]) {
        if (isDirectory(candidate, deps)) {
          add({
            id: "googledrive",
            label: "Google Drive",
            path: candidate,
            reason: "Google Drive for desktop on this PC.",
            recommended: true,
            source: "drive-letter",
          });
        }
      }
    }
  }

  // Well-known folders under the user profile.
  const wellKnown = [
    ["googledrive", "Google Drive", ["Google Drive", "Google Drive/My Drive", "Google Drive/Мой диск"], "Google Drive client on this PC."],
    ["yandexdisk", "Yandex.Disk", ["YandexDisk", "Yandex.Disk", "Яндекс.Диск", "Yandex Disk"], "Yandex.Disk client on this PC."],
    ["icloud", "iCloud Drive", ["iCloudDrive", "iCloud Drive", "Library/Mobile Documents/com~apple~CloudDocs"], "iCloud Drive on this PC."],
    ["mega", "MEGA", ["MEGA", "MEGAsync"], "MEGA client on this PC."],
    ["pcloud", "pCloud", ["pCloudDrive", "pCloud Drive", "pCloud"], "pCloud client on this PC."],
    ["nextcloud", "Nextcloud", ["Nextcloud"], "Nextcloud client on this PC."],
    ["owncloud", "ownCloud", ["ownCloud"], "ownCloud client on this PC."],
    ["box", "Box", ["Box", "Box Sync"], "Box client on this PC."],
    ["protondrive", "Proton Drive", ["Proton Drive", "ProtonDrive"], "Proton Drive client on this PC."],
    ["sync", "Sync.com", ["Sync"], "Sync.com client on this PC."],
    ["syncthing", "Syncthing", ["Sync", "Syncthing"], "Syncthing folder on this PC."],
    ["mailru", "Mail.ru Cloud", ["Mail.Ru Cloud", "Облако Mail.ru", "Cloud Mail.ru"], "Mail.ru Cloud client on this PC."],
    ["disk", "Cloud folder", ["Cloud", "CloudStation", "Synology Drive", "SynologyDrive"], "Cloud sync folder on this PC."],
  ];
  for (const [id, label, relatives, reason] of wellKnown) {
    for (const relative of relatives) {
      add({
        id: String(id),
        label: String(label),
        path: path.join(home, ...String(relative).split("/")),
        reason: String(reason),
        recommended: ["googledrive", "yandexdisk", "icloud", "nextcloud", "pcloud", "mega"].includes(String(id)),
        source: "well-known",
      });
    }
  }

  // pCloud Drive mounts as P: on Windows.
  if (platform === "win32" && isDirectory("P:\\pCloud Drive", deps)) {
    add({
      id: "pcloud",
      label: "pCloud Drive",
      path: "P:\\pCloud Drive",
      reason: "pCloud Drive on this PC.",
      recommended: true,
      source: "drive-letter",
    });
  }

  return found;
}

module.exports = {
  SAVE_STORAGE_SUBFOLDER,
  detectCloudSyncFolders,
  readDropboxPaths,
};
