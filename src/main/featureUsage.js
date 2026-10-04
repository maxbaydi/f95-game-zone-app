// @ts-check

const fs = require("fs");
const { writeFileAtomicSync } = require("./atomicFile");

// Which app features people actually use, for the anonymous usage stats
// (docs/feature-usage-stats.md). Only the fixed feature names below are
// counted, as plain numbers; nothing about games, files or the library. The
// counts ride along with the daily ping and are dropped while statistics are
// switched off.

const FEATURE_USAGE_FILE_NAME = "feature-usage.json";
const MAX_FEATURE_USES = 100000;

/**
 * User actions, recognised by the IPC channel the page calls. Reads and
 * background calls are left out on purpose. The optional third entry decides
 * per call (the library scan the app runs by itself at startup is not a
 * user action).
 *
 * @type {Array<[string, string, ((payload: any) => boolean)?]>}
 */
const CHANNEL_FEATURES = [
  ["launch-game", "library.launch"],
  ["set-game-favorite", "library.favorite"],
  ["scan-library", "library.rescan", (payload) => payload?.reason !== "startup"],
  ["link-game-to-catalog", "library.link-catalog"],
  ["remove-library-game", "library.remove"],
  ["delete-game-completely", "library.remove"],
  ["delete-version", "library.remove"],
  ["relocate-game-version", "library.relocate"],
  ["set-game-executable", "library.executable"],
  ["open-directory", "library.open-folder"],
  ["create-library-backup", "library.backup"],
  ["restore-library-backup", "library.restore-backup"],
  ["open-importer", "import.open"],
  ["start-scan", "import.scan"],
  ["start-scan-sources", "import.scan"],
  ["import-games", "import.import"],
  ["start-steam-scan", "import.steam"],
  ["add-scan-source", "import.add-source"],
  ["detect-game-folders", "import.detect-folders"],
  ["search-site-catalog", "catalog.search"],
  ["add-f95-thread-to-library", "catalog.add-to-library"],
  ["open-f95-login", "catalog.login"],
  ["install-f95-thread", "downloads.install"],
  ["install-f95-download-from-file", "downloads.manual-install"],
  ["install-f95-download-from-folder", "downloads.manual-install"],
  ["retry-f95-download", "downloads.retry"],
  ["retry-f95-install", "downloads.retry"],
  ["cancel-f95-download", "downloads.cancel"],
  ["open-f95-download-in-browser", "downloads.browser-step"],
  ["open-f95-download-action", "downloads.browser-step"],
  ["check-live-updates", "updates.check-now"],
  ["install-app-update", "updates.app-install"],
  ["connect-save-storage", "saves.connect"],
  ["sync-save-storage-all", "saves.sync"],
  ["sync-save-storage-game", "saves.sync"],
  ["export-game-saves", "saves.export"],
  ["export-all-game-saves", "saves.export"],
  ["import-game-saves", "saves.import"],
  ["open-save-location", "saves.open-folder"],
  ["export-save-storage-card", "saves.transfer-card"],
  ["import-save-storage-card", "saves.transfer-card"],
  ["save-emulator-config", "settings.emulator"],
  ["set-selected-banner-template", "settings.banner-template"],
];

// Where the user goes; the page reports these itself.
const RENDERER_FEATURES = Object.freeze([
  "section.library",
  "section.updates",
  "section.search",
  "section.settings",
  "downloads.open-panel",
  "settings.page-general",
  "settings.page-library",
  "settings.page-saves",
  "settings.page-notifications",
  "settings.page-appearance",
  "settings.page-emulators",
  "settings.page-about",
]);

const FEATURES = Object.freeze(
  [
    ...new Set([
      "app.launch",
      ...CHANNEL_FEATURES.map((entry) => entry[1]),
      ...RENDERER_FEATURES,
    ]),
  ].sort(),
);

const FEATURE_SET = new Set(FEATURES);
const RENDERER_FEATURE_SET = new Set(RENDERER_FEATURES);
const CHANNEL_MAP = new Map(CHANNEL_FEATURES.map((entry) => [entry[0], entry]));

/**
 * @param {string} channel
 * @param {unknown} [payload] first argument of the IPC call
 * @returns {string} the feature, or "" when the call is not a user action
 */
function featureForChannel(channel, payload) {
  const entry = CHANNEL_MAP.get(channel);
  if (!entry) {
    return "";
  }
  const [, feature, counts] = entry;
  return !counts || counts(payload) ? feature : "";
}

/**
 * @param {unknown} value
 */
function toCount(value) {
  const number = Number(value);
  if (typeof value !== "number" || !Number.isInteger(number) || number < 1) {
    return 0;
  }
  return Math.min(number, MAX_FEATURE_USES);
}

/**
 * @param {{
 *   statePath: string,
 *   isEnabled: () => boolean,
 *   fs?: typeof fs,
 * }} options
 */
function createFeatureUsageCounter(options) {
  const fsImpl = options.fs || fs;
  /** @type {Map<string, number>} */
  const counts = new Map();
  let dirty = false;

  const isEnabled = () => {
    try {
      return options.isEnabled() !== false;
    } catch {
      return false;
    }
  };

  try {
    const parsed = JSON.parse(fsImpl.readFileSync(options.statePath, "utf8"));
    const stored = parsed && typeof parsed.counts === "object" ? parsed.counts : {};
    for (const [feature, value] of Object.entries(stored || {})) {
      const count = toCount(value);
      if (FEATURE_SET.has(feature) && count > 0) {
        counts.set(feature, count);
      }
    }
  } catch {
    // No file yet or a damaged one: start from zero.
  }

  /**
   * @param {string} feature
   */
  function record(feature) {
    if (!FEATURE_SET.has(feature) || !isEnabled()) {
      return false;
    }
    counts.set(feature, Math.min((counts.get(feature) || 0) + 1, MAX_FEATURE_USES));
    dirty = true;
    return true;
  }

  /** Unsent counts, as sent with the next ping. */
  function pending() {
    return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  /**
   * Called after a successful ping: removes what that ping carried and keeps
   * whatever was used while it was in flight.
   *
   * @param {Record<string, number>} sent
   */
  function acknowledge(sent) {
    for (const [feature, value] of Object.entries(sent || {})) {
      const left = (counts.get(feature) || 0) - (Number(value) || 0);
      if (left > 0) {
        counts.set(feature, left);
      } else {
        counts.delete(feature);
      }
    }
    dirty = true;
    flush();
  }

  /** Keeps unsent counts across restarts; drops them while stats are off. */
  function flush() {
    if (!isEnabled()) {
      counts.clear();
      dirty = false;
      fsImpl.rmSync(options.statePath, { force: true });
      return;
    }
    if (!dirty) {
      return;
    }
    if (counts.size === 0) {
      fsImpl.rmSync(options.statePath, { force: true });
    } else {
      writeFileAtomicSync(
        options.statePath,
        `${JSON.stringify({ counts: pending() }, null, 2)}\n`,
        { fs: fsImpl },
      );
    }
    dirty = false;
  }

  return {
    record,
    /** Only the "where the user goes" names may come from the page. */
    recordRenderer: (/** @type {unknown} */ feature) =>
      typeof feature === "string" && RENDERER_FEATURE_SET.has(feature)
        ? record(feature)
        : false,
    recordChannel: (/** @type {string} */ channel, /** @type {unknown} */ payload) => {
      const feature = featureForChannel(channel, payload);
      return feature ? record(feature) : false;
    },
    pending,
    acknowledge,
    flush,
  };
}

/**
 * Counts user actions as they arrive over IPC. Must run before any handler
 * is registered; handlers for other channels are registered untouched.
 * Counting never changes or breaks the action itself.
 *
 * @param {{ handle: (channel: string, handler: (event: any, ...args: any[]) => any) => void }} ipcMain
 * @param {{ recordChannel: (channel: string, payload?: unknown) => unknown }} counter
 */
function instrumentIpcHandlers(ipcMain, counter) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    if (!CHANNEL_MAP.has(channel)) {
      handle(channel, handler);
      return;
    }
    handle(channel, (event, ...args) => {
      try {
        counter.recordChannel(channel, args[0]);
      } catch {
        // Statistics must never get in the way of the action.
      }
      return handler(event, ...args);
    });
  };
}

module.exports = {
  FEATURES,
  FEATURE_USAGE_FILE_NAME,
  MAX_FEATURE_USES,
  RENDERER_FEATURES,
  createFeatureUsageCounter,
  featureForChannel,
  instrumentIpcHandlers,
};
