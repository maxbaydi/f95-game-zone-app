const fs = require("fs");
const path = require("path");

const {
  DownloadCancelledError,
  MirrorActionRequiredError,
  MirrorError,
  TEXTUAL_MIME_TYPES,
  cancelResponseBody,
  createResolverContext,
  hostnameOf,
  isFileResponse,
  isTransientError,
  looksLikeHtmlDocument,
  normalizeHostname,
  readResponseText,
} = require("./hosts/common");
const {
  getMirrorHostInfo,
  interpretMirrorTransferError,
  isKnownMirrorHost,
  prepareMirrorDownload,
} = require("./hosts");
const {
  extractGoogleDriveConfirmUrl,
  extractGoogleDriveDirectUrlFromHtml,
  extractGoogleDriveFileId,
  resolveGoogleDriveUrlWithContext,
} = require("./hosts/googleDrive");
const {
  extractGofileContentId,
  generateGofileWebsiteToken,
  resolveGofileTarget,
} = require("./hosts/gofile");
const {
  extractMixdropFileRef,
  resolveMixdropTarget,
  unpackDeanEdwardsPackedJs,
} = require("./hosts/mixdrop");
const { resolveUploadhavenTarget } = require("./hosts/uploadhaven");
const {
  extractHtmlDownloadCandidates,
  parseCountdownLandingConfig,
  resolveHtmlLandingDownloadUrlWithContext,
  submitCountdownLanding,
} = require("./hosts/xfilesharing");
const { resolveKnownFileHostUrl } = require("./hosts/pixeldrain");
const { createMegaDecryptTransform } = require("./hosts/mega");

const TEXTUAL_PAGE_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "txt",
  "json",
  "xml",
  "js",
  "mjs",
  "php",
  "asp",
  "aspx",
  "jsp",
]);

const F95_TITLE_NOISE_PREFIXES = [
  "vn",
  "ren'py",
  "renpy",
  "unity",
  "html",
  "flash",
  "rpgm",
  "rpgm mv",
  "rpgm mz",
  "rpg maker",
  "wolf rpg",
  "visual novel",
  "windows",
  "window",
  "win",
  "linux",
  "mac",
  "android",
  "ios",
  "completed",
  "ongoing",
  "abandoned",
  "onhold",
  "mod",
  "tool",
  "collection",
];

const F95_ENGINE_LABELS = {
  "ren'py": "Ren'Py",
  renpy: "Ren'Py",
  unity: "Unity",
  html: "HTML",
  flash: "Flash",
  rpgm: "RPGM",
  "rpgm mv": "RPGM",
  "rpgm mz": "RPGM",
  "rpg maker": "RPGM",
  "rpg maker mv": "RPGM",
  "rpg maker mz": "RPGM",
  "wolf rpg": "Wolf RPG",
  "unreal engine": "Unreal Engine",
  unreal: "Unreal Engine",
  godot: "Godot",
  java: "Java",
  webgl: "WebGL",
  adrift: "ADRIFT",
  qsp: "QSP",
  rags: "RAGS",
  tads: "Tads",
};

class DownloadValidationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DownloadValidationError";
    this.code = options.code || "invalid_download_payload";
    this.cleanupFile = options.cleanupFile !== false;
  }
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBracketTokens(rawTitle) {
  return Array.from(String(rawTitle || "").matchAll(/\[([^\]]+)\]/g)).map(
    (match) => normalizeText(match[1]),
  );
}

function isVersionLikeToken(token) {
  return (
    /^v?\d/i.test(token) ||
    /\d+\.\d+/.test(token) ||
    /(ep|episode|chapter|season)\s*\d+/i.test(token)
  );
}

function normalizeEngineLabel(value) {
  const normalizedToken = normalizeText(value)
    .toLowerCase()
    .replace(/^pre[-_\s]+/i, "")
    .replace(/[_-]+/g, " ");

  return F95_ENGINE_LABELS[normalizedToken] || "";
}

function peelLeadingNoisePrefixes(value) {
  let result = normalizeText(value);
  const sortedPrefixes = [...F95_TITLE_NOISE_PREFIXES].sort(
    (left, right) => right.length - left.length,
  );
  const removedPrefixes = [];

  let changed = true;
  while (changed && result) {
    changed = false;

    for (const prefix of sortedPrefixes) {
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const prefixPattern = new RegExp(`^${escapedPrefix}(?=\\s|$)`, "i");

      if (!prefixPattern.test(result)) {
        continue;
      }

      removedPrefixes.push(prefix.toLowerCase());
      result = normalizeText(
        result.replace(prefixPattern, " ").replace(/^[|:;,.!/?<>\-–—~]+/, " "),
      );
      changed = true;
    }
  }

  return {
    cleaned: result,
    removedPrefixes,
  };
}

function stripLeadingNoisePrefixes(value) {
  return peelLeadingNoisePrefixes(value).cleaned;
}

function sanitizeF95ThreadTitle(rawTitle) {
  const withoutBrackets = normalizeText(
    String(rawTitle || "")
      .replace(/\|\s*f95zone.*$/i, " ")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\s+[|]\s+/g, " ")
      .replace(/\s+[-–—]\s+/g, " "),
  );

  return stripLeadingNoisePrefixes(withoutBrackets) || withoutBrackets;
}

function parseF95ThreadTitle(rawTitle) {
  const normalizedRawTitle = normalizeText(rawTitle);
  const bracketTokens = extractBracketTokens(normalizedRawTitle);
  const version = bracketTokens.find(isVersionLikeToken) || "";
  const creator =
    [...bracketTokens]
      .reverse()
      .find(
        (token) =>
          !isVersionLikeToken(token) &&
          !F95_TITLE_NOISE_PREFIXES.includes(token.toLowerCase()),
      ) || "";
  const titleWithoutBrackets = normalizeText(
    normalizedRawTitle
      .replace(/\|\s*f95zone.*$/i, " ")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\s+[|]\s+/g, " ")
      .replace(/\s+[-–—]\s+/g, " "),
  );
  const { cleaned: strippedTitle, removedPrefixes } =
    peelLeadingNoisePrefixes(titleWithoutBrackets);
  const title = strippedTitle || titleWithoutBrackets;
  const engineFromPrefixes = removedPrefixes
    .map((prefix) => normalizeEngineLabel(prefix))
    .find(Boolean);
  const engineFromBrackets = bracketTokens
    .map((token) => normalizeEngineLabel(token))
    .find(Boolean);

  return {
    rawTitle: normalizedRawTitle,
    title: title || normalizedRawTitle,
    creator,
    version,
    engine: engineFromPrefixes || engineFromBrackets || "",
  };
}

function getNormalizedExtension(filePath) {
  return path.extname(filePath).replace(/^\./, "").toLowerCase();
}

function bufferStartsWith(buffer, signature) {
  if (!Buffer.isBuffer(buffer) || buffer.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => buffer[index] === value);
}

function detectArchiveTypeFromBuffer(buffer) {
  if (
    bufferStartsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    bufferStartsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    bufferStartsWith(buffer, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }

  if (bufferStartsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return "7z";
  }

  if (
    bufferStartsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) ||
    bufferStartsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
  ) {
    return "rar";
  }

  return "";
}

async function readFileHeader(filePath, bytesToRead = 4096) {
  const handle = await fs.promises.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Resolve a thread mirror link (masked F95 link or direct host link) into a
 * transfer target. See src/main/f95/hosts/index.js for the host registry.
 *
 * Returns `{requestedUrl, resolvedUrl, sourceHost, mirrorHost, hostId,
 * hostLabel, transfer, rangeMode, headers, fileName, size, mega}`.
 * @param {any} session
 * @param {string} rawUrl
 * @param {Parameters<typeof prepareMirrorDownload>[2]} [options]
 */
async function prepareF95DownloadUrl(session, rawUrl, options = {}) {
  return prepareMirrorDownload(session, rawUrl, options);
}

// ─── Legacy single-host helpers (kept for callers and regression tests) ─────

function createLegacyContext(session, options = {}) {
  return createResolverContext({ session, ...options });
}

function targetToUrl(result, fallbackUrl) {
  if (!result) {
    return fallbackUrl;
  }
  return typeof result === "string" ? result : result.url || fallbackUrl;
}

async function resolveGofileUrl(session, rawUrl) {
  return targetToUrl(
    await resolveGofileTarget(createLegacyContext(session), rawUrl),
    rawUrl,
  );
}

async function resolveGoogleDriveUrl(session, rawUrl) {
  return resolveGoogleDriveUrlWithContext(createLegacyContext(session), rawUrl);
}

async function resolveMixdropUrl(session, rawUrl) {
  return targetToUrl(
    await resolveMixdropTarget(createLegacyContext(session), rawUrl),
    rawUrl,
  );
}

/**
 * @param {any} session
 * @param {string} rawUrl
 * @param {{delayMs?: number}} [options]
 */
async function resolveUploadhavenUrl(session, rawUrl, options = {}) {
  return targetToUrl(
    await resolveUploadhavenTarget(createLegacyContext(session), rawUrl, options),
    rawUrl,
  );
}

async function resolveHtmlLandingDownloadUrl(session, rawUrl, seenUrls = new Set()) {
  return resolveHtmlLandingDownloadUrlWithContext(
    createLegacyContext(session),
    rawUrl,
    seenUrls,
  );
}

async function resolveCountdownLandingDownloadUrl(session, rawUrl) {
  const ctx = createLegacyContext(session);
  const response = await ctx.fetch(rawUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    return response.url || rawUrl;
  }

  const finalUrl = response.url || rawUrl;
  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return finalUrl;
  }

  const html = await readResponseText(response);
  const countdownConfig = parseCountdownLandingConfig(html, finalUrl);
  if (!countdownConfig) {
    return finalUrl;
  }

  return submitCountdownLanding(
    ctx,
    finalUrl,
    countdownConfig,
    hostnameOf(finalUrl) || "This mirror",
  );
}

async function inspectDownloadedPackage(input) {
  const archiveExtensions = (input.archiveExtensions || [])
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean);
  const gameExtensions = (input.gameExtensions || [])
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean);
  const extension = getNormalizedExtension(input.filePath);
  const header = await readFileHeader(input.filePath);
  const stats = await fs.promises.stat(input.filePath);
  const mimeType = String(input.mimeType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const archiveType = detectArchiveTypeFromBuffer(header);

  if (stats.size <= 0) {
    throw new DownloadValidationError("Downloaded file is empty.", {
      code: "empty_download",
    });
  }

  if (archiveType) {
    return {
      installKind: "archive",
      archiveType,
      normalizedExtension: archiveType,
    };
  }

  if (archiveExtensions.includes(extension)) {
    return {
      installKind: "archive",
      archiveType: extension,
      normalizedExtension: extension,
    };
  }

  if (
    TEXTUAL_MIME_TYPES.has(mimeType) ||
    looksLikeHtmlDocument(header) ||
    TEXTUAL_PAGE_EXTENSIONS.has(extension)
  ) {
    throw new DownloadValidationError(
      "Mirror returned an HTML/text page instead of a game package. F95Launcher must not treat that as a successful install.",
      {
        code: "html_payload",
      },
    );
  }

  const supportedStandaloneExtensions = new Set(gameExtensions);
  supportedStandaloneExtensions.delete("html");
  supportedStandaloneExtensions.delete("htm");

  if (supportedStandaloneExtensions.has(extension)) {
    return {
      installKind: "file",
      normalizedExtension: extension,
    };
  }

  throw new DownloadValidationError(
    `Downloaded payload is not a supported install package: ${path.basename(input.filePath)}`,
    {
      code: "unsupported_payload",
      cleanupFile: false,
    },
  );
}

module.exports = {
  DownloadCancelledError,
  DownloadValidationError,
  MirrorActionRequiredError,
  MirrorError,
  createMegaDecryptTransform,
  detectArchiveTypeFromBuffer,
  extractGofileContentId,
  extractGoogleDriveConfirmUrl,
  extractGoogleDriveDirectUrlFromHtml,
  extractGoogleDriveFileId,
  extractHtmlDownloadCandidates,
  extractMixdropFileRef,
  generateGofileWebsiteToken,
  getMirrorHostInfo,
  inspectDownloadedPackage,
  interpretMirrorTransferError,
  isKnownMirrorHost,
  isTransientError,
  looksLikeHtmlDocument,
  normalizeEngineLabel,
  normalizeHostname,
  parseCountdownLandingConfig,
  parseF95ThreadTitle,
  prepareF95DownloadUrl,
  resolveCountdownLandingDownloadUrl,
  resolveGofileUrl,
  resolveGoogleDriveUrl,
  resolveHtmlLandingDownloadUrl,
  resolveKnownFileHostUrl,
  resolveMixdropUrl,
  resolveUploadhavenUrl,
  sanitizeF95ThreadTitle,
  unpackDeanEdwardsPackedJs,
};
