/**
 * Single source of truth for how a prepared mirror download is handed to the
 * transfer pipeline (`downloadToFile`).
 *
 * `startDirectF95Download` in the Electron main process and the offline
 * verification tool `scripts/check-mirrors.js` both build their options here,
 * so a host verified by the script behaves identically inside the app.
 */
const { DIRECT_DOWNLOAD_USER_AGENT } = require("./directDownload");
const { createMegaDecryptTransform } = require("./hosts/mega");
const { interpretMirrorTransferError } = require("./hosts");

const DEFAULT_FALLBACK_FILE_NAME = "download.bin";

/**
 * Characters Windows refuses in file names plus control characters.
 * @param {string} value
 * @param {string} [fallback]
 */
function sanitizeDownloadFileName(value, fallback = DEFAULT_FALLBACK_FILE_NAME) {
  const normalized = String(value || "")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

/**
 * Request headers for the transfer: a browser-like identity plus whatever
 * the resolver asked for (cookies, referer, ...). Resolver headers win.
 *
 * Pass the identity of the session the user solves browser checks in
 * (`session.getUserAgent()` in Electron): Cloudflare clearances are bound
 * to the user agent that earned them.
 * @param {{headers?: Record<string, string> | null}} prepared
 * @param {{userAgent?: string}} [options]
 * @returns {Record<string, string>}
 */
function buildDirectTransferHeaders(prepared, options = {}) {
  return {
    accept: "*/*",
    "user-agent": String(options.userAgent || "").trim() || DIRECT_DOWNLOAD_USER_AGENT,
    ...(prepared?.headers || {}),
  };
}

/**
 * @typedef {{
 *   requestedUrl?: string,
 *   resolvedUrl: string,
 *   hostId?: string,
 *   hostLabel?: string,
 *   transfer?: string,
 *   rangeMode?: string,
 *   headers?: Record<string, string> | null,
 *   fileName?: string,
 *   size?: number,
 *   mega?: {keyHex: string, ivHex: string} | null,
 * }} PreparedDownload
 */

/**
 * Build the options object for `downloadToFile` from a prepared download.
 *
 * Only the fields the caller provides are forwarded for the optional pipeline
 * tunables (`sleep`, `checkDiskSpace`, timeouts, ...), so `downloadToFile`
 * keeps applying its own defaults otherwise.
 *
 * @param {{
 *   prepared: PreparedDownload,
 *   fetchImpl: (url: string, init: any) => Promise<any>,
 *   resolveTargetPath: (fileName: string) => string,
 *   signal?: AbortSignal | null,
 *   hostLabel?: string,
 *   userAgent?: string,
 *   fallbackFileName?: string,
 *   onTarget?: ((info: any) => void) | null,
 *   onProgress?: ((info: any) => void) | null,
 *   onRetry?: ((info: any) => void) | null,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   checkDiskSpace?: (directory: string, requiredBytes: number) => Promise<void>,
 *   progressIntervalMs?: number,
 *   stallTimeoutMs?: number,
 *   connectTimeoutMs?: number,
 *   maxConsecutiveFailures?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 * }} input
 */
function buildDirectTransferOptions(input) {
  const prepared = input?.prepared;
  const resolvedUrl = String(prepared?.resolvedUrl || "").trim();
  if (!resolvedUrl) {
    throw new TypeError("buildDirectTransferOptions requires prepared.resolvedUrl.");
  }
  if (typeof input.fetchImpl !== "function") {
    throw new TypeError("buildDirectTransferOptions requires fetchImpl.");
  }
  if (typeof input.resolveTargetPath !== "function") {
    throw new TypeError("buildDirectTransferOptions requires resolveTargetPath.");
  }

  const mega = prepared.transfer === "mega" && prepared.mega ? prepared.mega : null;

  /** @type {any} */
  const options = {
    fetchImpl: input.fetchImpl,
    url: resolvedUrl,
    headers: buildDirectTransferHeaders(prepared, { userAgent: input.userAgent }),
    signal: input.signal || null,
    hostLabel: input.hostLabel || prepared.hostLabel || "",
    fileNameHint: String(prepared.fileName || "").trim(),
    expectedSize: Number(prepared.size) || 0,
    fallbackFileName: input.fallbackFileName || DEFAULT_FALLBACK_FILE_NAME,
    rangeMode: prepared.rangeMode || "header",
    createTransform: mega
      ? (offset) => createMegaDecryptTransform({ ...mega, offset })
      : null,
    interpretErrorResponse: (info) => interpretMirrorTransferError(prepared, info),
    resolveTargetPath: input.resolveTargetPath,
    onTarget: input.onTarget || null,
    onProgress: input.onProgress || null,
    onRetry: input.onRetry || null,
  };

  for (const key of [
    "sleep",
    "checkDiskSpace",
    "progressIntervalMs",
    "stallTimeoutMs",
    "connectTimeoutMs",
    "maxConsecutiveFailures",
    "baseDelayMs",
    "maxDelayMs",
  ]) {
    if (input[key] !== undefined) {
      options[key] = input[key];
    }
  }

  return options;
}

module.exports = {
  DEFAULT_FALLBACK_FILE_NAME,
  buildDirectTransferHeaders,
  buildDirectTransferOptions,
  sanitizeDownloadFileName,
};
