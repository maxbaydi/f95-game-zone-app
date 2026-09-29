// @ts-check

const fs = require("fs");
const path = require("path");

const LOG_SCOPE = "[library.backups]";
const AUTO_BACKUP_PREFIX = "library-auto";
const DAY_MS = 24 * 60 * 60 * 1000;

const AUTO_BACKUP_DEFAULTS = Object.freeze({
  minIntervalMs: 7 * DAY_MS,
  keep: 4,
});

/**
 * @param {{ fileName: string }} backup
 */
function isAutomaticBackup(backup) {
  return String(backup?.fileName || "").startsWith(`${AUTO_BACKUP_PREFIX}-`);
}

/**
 * A weekly snapshot of the library database, taken in the background and
 * rotated so automatic copies never pile up. Manual backups (created from
 * Settings, or before a restore or rebuild) are never touched.
 *
 * @param {{
 *   listBackups: () => Promise<Array<{ path: string, fileName: string, createdAt: string }>>,
 *   createBackup: (input: { fileNamePrefix: string }) => Promise<string>,
 *   minIntervalMs?: number,
 *   keep?: number,
 *   now?: () => number,
 *   logger?: { info?: Function, warn?: Function, error?: Function },
 *   removeFile?: (filePath: string) => Promise<void>,
 * }} input
 * @returns {Promise<{ created: string, skipped: string, removed: string[] }>}
 */
async function runScheduledLibraryBackup(input) {
  const logger = input.logger || console;
  const now = typeof input.now === "function" ? input.now() : Date.now();
  const minIntervalMs =
    Number(input.minIntervalMs) > 0 ? Number(input.minIntervalMs) : AUTO_BACKUP_DEFAULTS.minIntervalMs;
  const keep = Number.isInteger(input.keep) && Number(input.keep) > 0 ? Number(input.keep) : AUTO_BACKUP_DEFAULTS.keep;
  const removeFile =
    typeof input.removeFile === "function"
      ? input.removeFile
      : (/** @type {string} */ filePath) => fs.promises.rm(filePath, { force: true });

  const backups = (await input.listBackups()).filter(isAutomaticBackup);
  const newestTime = backups.reduce((latest, backup) => {
    const time = Date.parse(backup.createdAt || "");
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0);

  if (newestTime && now - newestTime < minIntervalMs) {
    return { created: "", skipped: "recent", removed: [] };
  }

  const created = await input.createBackup({ fileNamePrefix: AUTO_BACKUP_PREFIX });
  if (typeof logger.info === "function") {
    logger.info(`${LOG_SCOPE} Automatic backup created:`, path.basename(created));
  }

  const rotated = [...backups]
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))
    .slice(Math.max(0, keep - 1));
  /** @type {string[]} */
  const removed = [];
  for (const backup of rotated) {
    try {
      await removeFile(backup.path);
      removed.push(backup.path);
    } catch (error) {
      if (typeof logger.warn === "function") {
        logger.warn(`${LOG_SCOPE} Could not remove an old automatic backup:`, {
          path: backup.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { created, skipped: "", removed };
}

module.exports = {
  AUTO_BACKUP_DEFAULTS,
  AUTO_BACKUP_PREFIX,
  isAutomaticBackup,
  runScheduledLibraryBackup,
};
