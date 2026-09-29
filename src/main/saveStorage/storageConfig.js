// @ts-check

/**
 * Persistence of the save storage connection.
 *
 * Non-secret settings live in config.ini under [SaveStorage] (type, folder,
 * URL, bucket ...). Secrets (passwords, keys, the encryption passphrase)
 * live in one separate file, encrypted with Electron's safeStorage when the
 * OS keychain is available. There is exactly one connection at a time:
 * connecting replaces the previous one, disconnecting removes both parts,
 * so no stale credentials pile up.
 *
 * A "connection card" is the same data packed into one file (optionally
 * sealed with a passphrase) so the user can reconnect on another PC with
 * one import.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { SAVE_STORAGE_TYPES } = require("./providers");

const SECRETS_FILE_NAME = "save-storage-secrets.json";
const CONNECTION_CARD_FORMAT = "f95launcher-save-storage";
const CONNECTION_CARD_VERSION = 1;

/** Which keys are public settings and which are secrets, per type. */
const CONNECTION_SHAPES = {
  [SAVE_STORAGE_TYPES.FOLDER]: {
    settings: ["folderPath", "label"],
    secrets: [],
  },
  [SAVE_STORAGE_TYPES.WEBDAV]: {
    settings: ["url", "username", "label"],
    secrets: ["password"],
  },
  [SAVE_STORAGE_TYPES.S3]: {
    settings: ["endpoint", "region", "bucket", "prefix", "forcePathStyle", "accessKeyId", "label"],
    secrets: ["secretAccessKey"],
  },
  [SAVE_STORAGE_TYPES.SUPABASE]: {
    settings: ["url", "bucket", "prefix", "label"],
    secrets: ["key"],
  },
};

/**
 * @typedef {{
 *   type: string,
 *   settings: Record<string, any>,
 *   secrets: Record<string, any>,
 *   encryption: { enabled: boolean, passphrase: string },
 *   connectedAt: string,
 *   deviceName: string,
 * }} SaveStorageConnection
 */

/**
 * @param {string} type
 * @param {Record<string, any>} input
 */
function splitConnectionInput(type, input) {
  const shape = CONNECTION_SHAPES[type];
  if (!shape) {
    throw new Error(`Unknown storage type: ${type}`);
  }
  const settings = {};
  const secrets = {};
  for (const key of shape.settings) {
    if (input?.[key] !== undefined && input?.[key] !== null) {
      settings[key] = typeof input[key] === "boolean" ? input[key] : String(input[key]).trim();
    }
  }
  for (const key of shape.secrets) {
    if (input?.[key] !== undefined && input?.[key] !== null) {
      secrets[key] = String(input[key]);
    }
  }
  return { settings, secrets };
}

/**
 * Reads the public part from the app config.
 * @param {Record<string, any> | null | undefined} config
 */
function readStorageSettings(config) {
  const section = config?.SaveStorage || {};
  const type = String(section.type || "").trim();
  if (!type || !CONNECTION_SHAPES[type]) {
    return null;
  }
  const settings = {};
  for (const key of CONNECTION_SHAPES[type].settings) {
    if (section[key] !== undefined && section[key] !== "") {
      settings[key] =
        key === "forcePathStyle"
          ? !/^(false|0|no|off)$/i.test(String(section[key]))
          : String(section[key]);
    }
  }
  return {
    type,
    settings,
    encryptionEnabled: /^(true|1|yes|on)$/i.test(String(section.encryption || "")),
    connectedAt: String(section.connectedAt || ""),
    deviceName: String(section.deviceName || ""),
  };
}

/**
 * Builds the [SaveStorage] section for config.ini. Unset keys are written
 * as empty strings so old values never linger from a previous connection.
 * @param {SaveStorageConnection | null} connection
 */
function buildStorageSection(connection) {
  const section = {
    type: "",
    folderPath: "",
    label: "",
    url: "",
    username: "",
    endpoint: "",
    region: "",
    bucket: "",
    prefix: "",
    forcePathStyle: "",
    accessKeyId: "",
    encryption: "false",
    connectedAt: "",
    deviceName: "",
  };
  if (!connection) {
    return section;
  }
  section.type = connection.type;
  for (const [key, value] of Object.entries(connection.settings || {})) {
    if (key in section) {
      section[key] = typeof value === "boolean" ? String(value) : String(value ?? "");
    }
  }
  section.encryption = connection.encryption?.enabled ? "true" : "false";
  section.connectedAt = connection.connectedAt || "";
  section.deviceName = connection.deviceName || "";
  return section;
}

// ─── Secrets file ────────────────────────────────────────────────────────

/**
 * @param {{ dataDir: string, safeStorage?: { isEncryptionAvailable: () => boolean, encryptString: (value: string) => Buffer, decryptString: (value: Buffer) => string } | null }} deps
 */
function createSecretsStore(deps) {
  const filePath = path.join(deps.dataDir, SECRETS_FILE_NAME);
  // Evaluated per call: Electron reports encryption as unavailable until the
  // app is ready, and the store is created before that.
  const getSafe = () => {
    try {
      return deps.safeStorage && deps.safeStorage.isEncryptionAvailable() ? deps.safeStorage : null;
    } catch {
      return null;
    }
  };

  return {
    filePath,
    get isEncrypted() {
      return Boolean(getSafe());
    },
    /** @returns {{ secrets: Record<string, any>, passphrase: string } | null} */
    read() {
      try {
        if (!fs.existsSync(filePath)) {
          return null;
        }
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        let payload;
        if (raw?.encrypted && typeof raw.data === "string") {
          const safe = getSafe();
          if (!safe) {
            return null;
          }
          payload = JSON.parse(safe.decryptString(Buffer.from(raw.data, "base64")));
        } else if (raw?.data && typeof raw.data === "object") {
          payload = raw.data;
        } else {
          return null;
        }
        return {
          secrets: payload?.secrets && typeof payload.secrets === "object" ? payload.secrets : {},
          passphrase: typeof payload?.passphrase === "string" ? payload.passphrase : "",
        };
      } catch {
        return null;
      }
    },
    /** @param {{ secrets: Record<string, any>, passphrase: string }} payload */
    write(payload) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const serialized = JSON.stringify({
        secrets: payload.secrets || {},
        passphrase: payload.passphrase || "",
      });
      const safe = getSafe();
      const document = safe
        ? { version: 1, encrypted: true, data: safe.encryptString(serialized).toString("base64") }
        : { version: 1, encrypted: false, data: JSON.parse(serialized) };
      const temp = `${filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(document), { mode: 0o600 });
      fs.renameSync(temp, filePath);
    },
    clear() {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Nothing to clean.
      }
    },
  };
}

// ─── Connection cards ────────────────────────────────────────────────────

const CARD_KDF = { N: 16384, r: 8, p: 1, keyLength: 32 };

/**
 * @param {string} passphrase
 * @param {Buffer} salt
 */
function deriveCardKey(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(String(passphrase), "utf8"), salt, CARD_KDF.keyLength, {
    N: CARD_KDF.N,
    r: CARD_KDF.r,
    p: CARD_KDF.p,
  });
}

/**
 * Packs a connection into a portable document. With a passphrase the whole
 * payload is sealed (AES-256-GCM); without it the card is plain JSON and
 * the caller should warn that it carries credentials.
 * @param {SaveStorageConnection} connection
 * @param {{ passphrase?: string, appVersion?: string, now?: () => Date }=} options
 */
function buildConnectionCard(connection, options = {}) {
  const payload = {
    type: connection.type,
    settings: connection.settings || {},
    secrets: connection.secrets || {},
    encryption: {
      enabled: Boolean(connection.encryption?.enabled),
      passphrase: connection.encryption?.enabled ? connection.encryption.passphrase || "" : "",
    },
  };
  const base = {
    format: CONNECTION_CARD_FORMAT,
    version: CONNECTION_CARD_VERSION,
    createdAt: (options.now || (() => new Date()))().toISOString(),
    app: { name: "F95Launcher", version: String(options.appVersion || "") },
  };
  const passphrase = String(options.passphrase || "");
  if (!passphrase) {
    return { ...base, sealed: false, payload };
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveCardKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return {
    ...base,
    sealed: true,
    kdf: { name: "scrypt", ...CARD_KDF, salt: salt.toString("base64") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
    data: encrypted.toString("base64"),
  };
}

/**
 * @param {any} card
 * @param {{ passphrase?: string }=} options
 * @returns {{ type: string, settings: Record<string, any>, secrets: Record<string, any>, encryption: { enabled: boolean, passphrase: string } }}
 */
function readConnectionCard(card, options = {}) {
  if (!card || card.format !== CONNECTION_CARD_FORMAT) {
    const error = new Error("This file is not an F95Launcher save storage card.");
    // @ts-ignore
    error.code = "invalid_card";
    throw error;
  }
  let payload;
  if (card.sealed) {
    const passphrase = String(options.passphrase || "");
    if (!passphrase) {
      const error = new Error("This card is protected with a passphrase.");
      // @ts-ignore
      error.code = "card_passphrase_required";
      throw error;
    }
    try {
      const salt = Buffer.from(card.kdf?.salt || "", "base64");
      const key = deriveCardKey(passphrase, salt);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(card.cipher?.iv || "", "base64"));
      decipher.setAuthTag(Buffer.from(card.cipher?.tag || "", "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(card.data || "", "base64")), decipher.final()]);
      payload = JSON.parse(plain.toString("utf8"));
    } catch {
      const error = new Error("The passphrase does not open this card.");
      // @ts-ignore
      error.code = "card_wrong_passphrase";
      throw error;
    }
  } else {
    payload = card.payload;
  }
  const type = String(payload?.type || "");
  if (!CONNECTION_SHAPES[type]) {
    const error = new Error("The card describes a storage type this version does not support.");
    // @ts-ignore
    error.code = "invalid_card";
    throw error;
  }
  const split = splitConnectionInput(type, { ...(payload.settings || {}), ...(payload.secrets || {}) });
  return {
    type,
    settings: split.settings,
    secrets: split.secrets,
    encryption: {
      enabled: Boolean(payload?.encryption?.enabled),
      passphrase: String(payload?.encryption?.passphrase || ""),
    },
  };
}

/**
 * Human-readable one-liner for the UI ("OneDrive · C:\Users\...\F95Launcher Saves").
 * @param {{ type: string, settings: Record<string, any> } | null} connection
 */
function describeConnection(connection) {
  if (!connection) {
    return "";
  }
  const settings = connection.settings || {};
  switch (connection.type) {
    case SAVE_STORAGE_TYPES.FOLDER:
      return settings.label ? `${settings.label} · ${settings.folderPath}` : String(settings.folderPath || "");
    case SAVE_STORAGE_TYPES.WEBDAV:
      return settings.label ? `${settings.label} · ${settings.url}` : String(settings.url || "");
    case SAVE_STORAGE_TYPES.S3:
      return `${settings.bucket || ""} @ ${String(settings.endpoint || "").replace(/^https?:\/\//, "")}`;
    case SAVE_STORAGE_TYPES.SUPABASE:
      return `Supabase · ${settings.bucket || "f95launcher-saves"} @ ${String(settings.url || "").replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
    default:
      return connection.type;
  }
}

module.exports = {
  CONNECTION_CARD_FORMAT,
  CONNECTION_CARD_VERSION,
  CONNECTION_SHAPES,
  SECRETS_FILE_NAME,
  buildConnectionCard,
  buildStorageSection,
  createSecretsStore,
  describeConnection,
  readConnectionCard,
  readStorageSettings,
  splitConnectionInput,
};
