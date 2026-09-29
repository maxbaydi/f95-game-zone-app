// @ts-check

const DEFAULT_GAME_EXTENSIONS = "exe,swf,flv,f4v,rag,cmd,bat,jar,html";
const DEFAULT_ARCHIVE_EXTENSIONS = "zip,7z,rar";

function toBoolean(value) {
  if (typeof value === "string") {
    return /^(?:true|1|yes|on)$/i.test(value.trim());
  }
  return Boolean(value);
}

function toText(value) {
  return String(value ?? "").trim();
}

/**
 * Normalizes a user-typed extension list such as ".EXE, html  swf" into
 * "exe,html,swf".
 */
function normalizeExtensionList(value, fallback) {
  const extensions = [
    ...new Set(
      String(value ?? "")
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().replace(/^\.+/, "").toLowerCase())
        .filter((entry) => /^[a-z0-9_]{1,12}$/.test(entry)),
    ),
  ];
  return extensions.length > 0 ? extensions.join(",") : fallback;
}

const MOTION_LEVELS = new Set(["auto", "full", "reduced", "off"]);

const SETTINGS_SCHEMA = {
  Interface: {
    minimizeToTray: toBoolean,
    openAtLogin: toBoolean,
    startMinimized: toBoolean,
    showGameList: toBoolean,
    showDebugConsole: toBoolean,
    motion: (value) => {
      const motion = toText(value).toLowerCase();
      return MOTION_LEVELS.has(motion) ? motion : "auto";
    },
  },
  Library: {
    gameFolder: toText,
    gameExtensions: (value) =>
      normalizeExtensionList(value, DEFAULT_GAME_EXTENSIONS),
    extractionExtensions: (value) =>
      normalizeExtensionList(value, DEFAULT_ARCHIVE_EXTENSIONS),
    autoScanOnStartup: toBoolean,
    autoBackup: toBoolean,
  },
  Notifications: {
    appUpdates: toBoolean,
    libraryUpdates: toBoolean,
    installs: toBoolean,
  },
  AppUpdates: {
    autoDownload: toBoolean,
  },
  LiveUpdates: {
    allGames: toBoolean,
  },
  Onboarding: {
    completed: toBoolean,
    completedAt: toText,
  },
};

/**
 * Applies a partial update to one settings section. Only known keys are
 * accepted so a renderer can never overwrite unrelated config such as cloud
 * credentials or remembered mirrors.
 *
 * @param {Record<string, any>} config
 * @param {string} section
 * @param {Record<string, unknown>} values
 */
function applySettingsPatch(config, section, values) {
  const schema = SETTINGS_SCHEMA[section];
  if (!schema) {
    throw new Error(`Unknown settings section: ${section}`);
  }

  const patch = {};
  for (const [key, rawValue] of Object.entries(values || {})) {
    const normalize = schema[key];
    if (!normalize) {
      throw new Error(`Unknown setting: ${section}.${key}`);
    }
    patch[key] = normalize(rawValue);
  }

  return {
    ...config,
    [section]: {
      ...(config?.[section] || {}),
      ...patch,
    },
  };
}

module.exports = {
  DEFAULT_ARCHIVE_EXTENSIONS,
  DEFAULT_GAME_EXTENSIONS,
  SETTINGS_SCHEMA,
  applySettingsPatch,
  normalizeExtensionList,
};
