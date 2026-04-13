const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TEXTUAL_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
  "application/javascript",
  "text/javascript",
]);

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

const GOFILE_CLIENT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Atlas/1.0 Chrome/125.0.0.0 Safari/537.36";
const GOFILE_CLIENT_LANGUAGE = "en-US";
const GOFILE_WT_SALT = "5d4f7g8sd45fsd";
const GOFILE_WT_WINDOW_SECONDS = 14400;

class DownloadValidationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DownloadValidationError";
    this.code = options.code || "invalid_download_payload";
    this.cleanupFile = options.cleanupFile !== false;
  }
}

class MirrorActionRequiredError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MirrorActionRequiredError";
    this.code = options.code || "mirror_action_required";
    this.actionUrl = options.actionUrl || "";
    this.userMessage = options.userMessage || message;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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

function looksLikeHtmlDocument(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return false;
  }

  const previewText = buffer
    .toString("utf8", 0, Math.min(buffer.length, 2048))
    .toLowerCase();

  return (
    previewText.includes("<!doctype html") ||
    previewText.includes("<html") ||
    previewText.includes("<head") ||
    previewText.includes("<body") ||
    previewText.includes("<title>link masked") ||
    previewText.includes("you're leaving f95zone")
  );
}

function isHtmlLikeContentType(contentType) {
  const normalizedContentType = String(contentType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();

  return (
    !normalizedContentType ||
    TEXTUAL_MIME_TYPES.has(normalizedContentType) ||
    normalizedContentType.startsWith("text/")
  );
}

function buildAbsoluteUrl(baseUrl, rawValue) {
  const normalizedValue = safeDecodeHtmlEntities(rawValue).trim();
  if (!normalizedValue || normalizedValue.startsWith("javascript:")) {
    return "";
  }

  try {
    return new URL(normalizedValue, baseUrl).toString();
  } catch {
    return "";
  }
}

function parseHtmlTagAttributes(rawAttributes) {
  const attributes = {};
  const attributePattern = /([:@a-zA-Z0-9_-]+)\s*=\s*["']([^"']*)["']/g;
  let match = null;

  while ((match = attributePattern.exec(String(rawAttributes || "")))) {
    attributes[String(match[1] || "").toLowerCase()] = safeDecodeHtmlEntities(
      match[2] || "",
    );
  }

  return attributes;
}

function decodeJavascriptEscapes(value) {
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\\//g, "/");
}

function extractHtmlTagAttributes(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "i");
  const match = String(html || "").match(pattern);
  if (!match) {
    return null;
  }

  return parseHtmlTagAttributes(match[1]);
}

function readTagAttribute(attributes, names) {
  for (const name of names) {
    const normalizedName = String(name || "").toLowerCase();
    if (
      attributes &&
      Object.prototype.hasOwnProperty.call(attributes, normalizedName)
    ) {
      return attributes[normalizedName];
    }
  }

  return "";
}

function parseBooleanAttribute(value) {
  return /^(true|1|yes)$/i.test(String(value || "").trim());
}

function parseCountdownLandingConfig(html, pageUrl) {
  const countdownAttributes = extractHtmlTagAttributes(
    html,
    "download-countdown",
  );
  if (!countdownAttributes) {
    return null;
  }

  const fileActionAttributes =
    extractHtmlTagAttributes(html, "file-actions") || {};
  const referer = readTagAttribute(countdownAttributes, ["referer"]) || pageUrl;
  const code =
    readTagAttribute(countdownAttributes, ["code"]) ||
    readTagAttribute(fileActionAttributes, ["code"]);

  if (!code) {
    return null;
  }

  return {
    code,
    referer,
    rand: readTagAttribute(countdownAttributes, ["rand"]),
    freeMethod: readTagAttribute(countdownAttributes, [
      "free-method",
      "freemethod",
    ]),
    premiumMethod: readTagAttribute(countdownAttributes, [
      "premium-method",
      "premiummethod",
    ]),
    countdown: Number(
      readTagAttribute(countdownAttributes, [":countdown", "countdown"]) || 0,
    ),
    hasCaptcha: parseBooleanAttribute(
      readTagAttribute(countdownAttributes, [":has-captcha", "has-captcha"]),
    ),
    hasPassword: parseBooleanAttribute(
      readTagAttribute(countdownAttributes, [":has-password", "has-password"]),
    ),
    hasCountdown: parseBooleanAttribute(
      readTagAttribute(countdownAttributes, [
        ":has-countdown",
        "has-countdown",
      ]),
    ),
    fileLink: readTagAttribute(fileActionAttributes, ["link"]),
    fileToken: readTagAttribute(fileActionAttributes, ["token"]),
  };
}

function isGoogleDriveHost(hostname) {
  const normalizedHost = normalizeHostname(hostname);
  return (
    normalizedHost === "drive.google.com" ||
    normalizedHost === "docs.google.com" ||
    normalizedHost === "drive.usercontent.google.com"
  );
}

function getHostFamily(hostname) {
  const parts = normalizeHostname(hostname).split(".").filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(".");
  }

  return parts.slice(-2).join(".");
}

function isSameHostFamily(baseUrl, candidateUrl) {
  try {
    const baseHost = new URL(baseUrl).hostname;
    const candidateHost = new URL(candidateUrl).hostname;
    return getHostFamily(baseHost) === getHostFamily(candidateHost);
  } catch {
    return false;
  }
}

function scoreHtmlDownloadCandidate(candidate) {
  const url = String(candidate?.url || "");
  const urlLower = url.toLowerCase();
  const context = normalizeText(candidate?.context || "").toLowerCase();
  let score = 0;

  if (/\/download(?:\/|$)|\/dl(?:\/|$)|[?&]download(?:=|&|$)/i.test(url)) {
    score += 80;
  }

  if (/direct/i.test(context)) {
    score += 25;
  }

  if (/download|get file|start/i.test(context)) {
    score += 35;
  }

  if (
    /pricing|terms|privacy|blog|help|contact|report|preview|show in browser/i.test(
      urlLower,
    )
  ) {
    score -= 120;
  }

  if (/pricing|terms|privacy|blog|help|contact|report|preview/i.test(context)) {
    score -= 80;
  }

  if (
    candidate?.attributeName &&
    /hx-get|href|formaction|action/i.test(candidate.attributeName)
  ) {
    score += 10;
  }

  return score;
}

function extractHtmlDownloadCandidates(pageUrl, html) {
  const candidates = [];
  const seen = new Set();
  const tagPattern = /<(a|button|form)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const attributePattern =
    /\b(href|hx-get|hx-post|data-href|data-url|formaction|action)\s*=\s*["']([^"']+)["']/gi;

  const pushCandidate = (attributeName, attributeValue, context) => {
    const absoluteUrl = buildAbsoluteUrl(pageUrl, attributeValue);
    if (!absoluteUrl || seen.has(`${attributeName}:${absoluteUrl}`)) {
      return;
    }

    if (!isSameHostFamily(pageUrl, absoluteUrl)) {
      return;
    }

    seen.add(`${attributeName}:${absoluteUrl}`);
    candidates.push({
      attributeName,
      url: absoluteUrl,
      context: normalizeText(context),
    });
  };

  let tagMatch = null;
  while ((tagMatch = tagPattern.exec(html))) {
    const [, tagName, attributes, innerHtml] = tagMatch;
    const context = normalizeText(
      safeDecodeHtmlEntities(
        `${attributes} ${String(innerHtml || "").replace(/<[^>]+>/g, " ")}`,
      ),
    );

    let attributeMatch = null;
    while ((attributeMatch = attributePattern.exec(attributes))) {
      pushCandidate(attributeMatch[1], attributeMatch[2], context || tagName);
    }
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreHtmlDownloadCandidate(candidate),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
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

async function buildCookieHeader(session, url) {
  if (!session?.cookies?.get) {
    return "";
  }

  const cookies = await session.cookies.get({ url });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function fetchWithSession(session, url, options) {
  if (session && typeof session.fetch === "function") {
    return session.fetch(url, options);
  }

  const headers = new Headers(options?.headers || {});
  const cookieHeader = await buildCookieHeader(session, url);
  if (cookieHeader && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

async function cancelResponseBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === "function") {
      await response.body.cancel();
    }
  } catch {
    // Ignore body cancellation failures.
  }
}

function extractGoogleDriveFileId(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isGoogleDriveHost(parsedUrl.hostname)) {
      return "";
    }

    const searchParamId = normalizeText(parsedUrl.searchParams.get("id"));
    if (searchParamId) {
      return searchParamId;
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    const driveFileIndex = segments.findIndex((segment) => segment === "d");
    if (driveFileIndex >= 0 && segments[driveFileIndex + 1]) {
      return normalizeText(segments[driveFileIndex + 1]);
    }

    return "";
  } catch {
    return "";
  }
}

function extractGoogleDriveResourceKey(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isGoogleDriveHost(parsedUrl.hostname)) {
      return "";
    }

    return normalizeText(parsedUrl.searchParams.get("resourcekey"));
  } catch {
    return "";
  }
}

function isGoogleDriveDownloadPath(pathname) {
  return /(?:^|\/)(?:uc|download)(?:$|[/?#])/i.test(String(pathname || ""));
}

function isGoogleDriveDirectDownloadUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!isGoogleDriveHost(parsedUrl.hostname)) {
      return false;
    }

    if (!isGoogleDriveDownloadPath(parsedUrl.pathname)) {
      return false;
    }

    return Boolean(
      normalizeText(parsedUrl.searchParams.get("id")) &&
        (normalizeText(parsedUrl.searchParams.get("export")) === "download" ||
          parsedUrl.pathname.toLowerCase().includes("/download") ||
          normalizeText(parsedUrl.searchParams.get("confirm"))),
    );
  } catch {
    return false;
  }
}

function buildGoogleDriveCandidateUrls(rawUrl) {
  const fileId = extractGoogleDriveFileId(rawUrl);
  if (!fileId) {
    return [rawUrl];
  }

  const resourceKey = extractGoogleDriveResourceKey(rawUrl);
  const candidates = new Set([rawUrl]);
  const addCandidate = (hostname, pathname) => {
    const candidateUrl = new URL(`https://${hostname}${pathname}`);
    candidateUrl.searchParams.set("export", "download");
    candidateUrl.searchParams.set("id", fileId);
    if (resourceKey) {
      candidateUrl.searchParams.set("resourcekey", resourceKey);
    }
    candidates.add(candidateUrl.toString());
  };

  addCandidate("drive.google.com", "/uc");
  addCandidate("drive.usercontent.google.com", "/uc");
  addCandidate("drive.usercontent.google.com", "/download");

  return [...candidates];
}

function extractGoogleDriveDirectUrlFromHtml(html) {
  const normalizedHtml = decodeJavascriptEscapes(String(html || ""));
  const directUrlMatches =
    normalizedHtml.match(
      /https:\/\/drive(?:\.usercontent)?\.google\.com\/(?:u\/\d+\/)?(?:uc|download)\?[^"'<>\\\s]+/gi,
    ) || [];

  for (const rawMatch of directUrlMatches) {
    const directUrl = safeDecodeHtmlEntities(rawMatch).trim();
    if (isGoogleDriveDirectDownloadUrl(directUrl)) {
      return directUrl;
    }
  }

  return "";
}

function extractGoogleDriveConfirmUrl(html, pageUrl) {
  const normalizedHtml = decodeJavascriptEscapes(String(html || ""));
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch = null;

  while ((formMatch = formPattern.exec(normalizedHtml))) {
    const formAttributes = parseHtmlTagAttributes(formMatch[1]);
    const actionUrl = buildAbsoluteUrl(pageUrl, formAttributes.action || "");
    if (!actionUrl) {
      continue;
    }

    let parsedAction = null;
    try {
      parsedAction = new URL(actionUrl);
    } catch {
      continue;
    }

    if (
      !isGoogleDriveHost(parsedAction.hostname) ||
      !isGoogleDriveDownloadPath(parsedAction.pathname)
    ) {
      continue;
    }

    const inputPattern = /<input\b([^>]*)>/gi;
    let inputMatch = null;
    while ((inputMatch = inputPattern.exec(formMatch[2]))) {
      const inputAttributes = parseHtmlTagAttributes(inputMatch[1]);
      const inputName = normalizeText(inputAttributes.name);
      if (!inputName) {
        continue;
      }

      parsedAction.searchParams.set(inputName, inputAttributes.value || "");
    }

    if (!parsedAction.searchParams.get("export")) {
      parsedAction.searchParams.set("export", "download");
    }

    return parsedAction.toString();
  }

  return "";
}

function extractGofileContentId(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (normalizeHostname(parsedUrl.hostname) !== "gofile.io") {
      return "";
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && segments[0].toLowerCase() === "d") {
      return segments[1];
    }

    if (
      segments.length >= 3 &&
      segments[0].toLowerCase() === "download" &&
      segments[1].toLowerCase() === "web"
    ) {
      return segments[2];
    }

    if (segments.length >= 2 && segments[0].toLowerCase() === "file") {
      return segments[1];
    }

    return "";
  } catch {
    return "";
  }
}

function extractNestedDownloadUrl(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const normalizedType = normalizeText(value.type).toLowerCase();

  if (normalizedType === "file") {
    if (typeof value.directLink === "string" && value.directLink.trim()) {
      return value.directLink.trim();
    }

    if (typeof value.link === "string" && value.link.trim()) {
      return value.link.trim();
    }
  }

  if (Array.isArray(value.children)) {
    for (const entry of value.children) {
      const nestedUrl = extractNestedDownloadUrl(entry);
      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }

  if (value.children && typeof value.children === "object") {
    for (const entry of Object.values(value.children)) {
      const nestedUrl = extractNestedDownloadUrl(entry);
      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }

  if (value.directLinks && typeof value.directLinks === "object") {
    for (const directLink of Object.values(value.directLinks)) {
      if (typeof directLink === "string" && directLink.trim()) {
        return directLink.trim();
      }
    }
  }

  return "";
}

async function createGofileGuestToken(session) {
  const response = await fetchWithSession(
    session,
    "https://api.gofile.io/accounts",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "user-agent": GOFILE_CLIENT_USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gofile account bootstrap failed with HTTP ${response.status}.`,
    );
  }

  const payload = await response.json().catch(() => null);
  const token = payload?.data?.token;
  if (!token) {
    throw new Error("Gofile did not return a guest access token.");
  }

  return token;
}

function generateGofileWebsiteToken(token, options = {}) {
  const userAgent = options.userAgent || GOFILE_CLIENT_USER_AGENT;
  const language = options.language || GOFILE_CLIENT_LANGUAGE;
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const windowBucket = Math.floor(
    Math.floor(nowMs / 1000) / GOFILE_WT_WINDOW_SECONDS,
  ).toString();
  const signatureInput = `${userAgent}::${language}::${token}::${windowBucket}::${GOFILE_WT_SALT}`;

  return crypto.createHash("sha256").update(signatureInput).digest("hex");
}

async function syncGofileGuestAccount(session, token) {
  const response = await fetchWithSession(
    session,
    "https://api.gofile.io/accounts/website",
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": GOFILE_CLIENT_USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Gofile account sync failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  if (payload?.status !== "ok" || !payload?.data?.token) {
    throw new Error("Gofile did not return a usable synced account.");
  }

  return payload.data;
}

async function resolveGofileUrl(session, rawUrl) {
  const contentId = extractGofileContentId(rawUrl);
  if (!contentId) {
    return rawUrl;
  }

  const guestToken = await createGofileGuestToken(session);
  const account = await syncGofileGuestAccount(session, guestToken);
  const websiteToken = generateGofileWebsiteToken(account.token, {
    userAgent: GOFILE_CLIENT_USER_AGENT,
    language: GOFILE_CLIENT_LANGUAGE,
  });
  const response = await fetchWithSession(
    session,
    `https://api.gofile.io/contents/${encodeURIComponent(contentId)}`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.token}`,
        "x-website-token": websiteToken,
        "x-bl": GOFILE_CLIENT_LANGUAGE,
        "user-agent": GOFILE_CLIENT_USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gofile content lookup failed with HTTP ${response.status}.`,
    );
  }

  const payload = await response.json().catch(() => null);
  const status = String(payload?.status || "");

  if (status === "error-notPremium") {
    throw new Error(
      "This Gofile mirror requires a premium/direct-download path and cannot be installed automatically.",
    );
  }

  if (status && status !== "ok") {
    throw new Error(
      payload?.status === "error-notFound"
        ? "This Gofile mirror no longer exists."
        : payload?.status || "Gofile content lookup failed.",
    );
  }

  const resolvedUrl = extractNestedDownloadUrl(payload?.data || {});
  if (!resolvedUrl) {
    throw new Error(
      "Gofile did not expose a downloadable file URL for this mirror.",
    );
  }

  return resolvedUrl;
}

async function resolveGoogleDriveCandidateUrl(session, candidateUrl, seenUrls) {
  if (!candidateUrl || seenUrls.has(candidateUrl)) {
    return "";
  }

  seenUrls.add(candidateUrl);

  const response = await fetchWithSession(session, candidateUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`Google Drive mirror failed with HTTP ${response.status}.`);
  }

  const finalUrl = response.url || candidateUrl;
  const contentType = response.headers.get("content-type") || "";
  const contentDisposition = response.headers.get("content-disposition") || "";

  if (
    /attachment/i.test(contentDisposition) ||
    !isHtmlLikeContentType(contentType)
  ) {
    await cancelResponseBody(response);
    return finalUrl;
  }

  const html = await response.text();
  if (
    /Google Drive - Quota exceeded|too many users have viewed or downloaded this file|can't view or download this file at this time/i.test(
      html,
    )
  ) {
    throw new Error(
      "This Google Drive mirror is temporarily unavailable because its public download quota is exceeded.",
    );
  }

  const embeddedDirectUrl = extractGoogleDriveDirectUrlFromHtml(html);
  if (embeddedDirectUrl && !seenUrls.has(embeddedDirectUrl)) {
    const resolvedEmbeddedUrl = await resolveGoogleDriveCandidateUrl(
      session,
      embeddedDirectUrl,
      seenUrls,
    );
    if (resolvedEmbeddedUrl) {
      return resolvedEmbeddedUrl;
    }
  }

  const confirmUrl = extractGoogleDriveConfirmUrl(html, finalUrl);
  if (confirmUrl && !seenUrls.has(confirmUrl)) {
    const resolvedConfirmUrl = await resolveGoogleDriveCandidateUrl(
      session,
      confirmUrl,
      seenUrls,
    );
    if (resolvedConfirmUrl) {
      return resolvedConfirmUrl;
    }
  }

  throw new Error(
    "Google Drive returned an unsupported interstitial page instead of a direct download.",
  );
}

async function resolveGoogleDriveUrl(session, rawUrl) {
  try {
    if (!isGoogleDriveHost(new URL(rawUrl).hostname)) {
      return rawUrl;
    }
  } catch {
    return rawUrl;
  }

  const seenUrls = new Set();
  const candidateUrls = buildGoogleDriveCandidateUrls(rawUrl);
  let lastError = null;

  for (const candidateUrl of candidateUrls) {
    try {
      const resolvedUrl = await resolveGoogleDriveCandidateUrl(
        session,
        candidateUrl,
        seenUrls,
      );
      if (resolvedUrl) {
        return resolvedUrl;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return rawUrl;
}

async function resolveMaskedF95Url(session, maskedUrl) {
  const requestBody = new URLSearchParams({
    xhr: "1",
    download: "1",
  }).toString();

  const response = await fetchWithSession(session, maskedUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`F95 masked link failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new Error("F95 masked link returned an invalid response.");
  }

  if (payload.status === "ok" && payload.msg) {
    return String(payload.msg);
  }

  if (payload.status === "captcha") {
    throw new MirrorActionRequiredError(
      "This masked F95 link now requires captcha confirmation. Open the mirror in the embedded browser and finish the captcha there.",
      {
        code: "captcha_required",
        actionUrl: maskedUrl,
        userMessage:
          "This mirror needs captcha confirmation before F95Launcher can continue. Finish the captcha, then retry the install.",
      },
    );
  }

  throw new Error(
    payload.msg || "F95 did not return a downloadable mirror for this thread.",
  );
}

async function resolveCountdownLandingDownloadUrl(session, rawUrl) {
  const response = await fetchWithSession(session, rawUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    return response.url || rawUrl;
  }

  const finalUrl = response.url || rawUrl;
  const contentType = response.headers.get("content-type") || "";
  const contentDisposition = response.headers.get("content-disposition") || "";

  if (
    /attachment/i.test(contentDisposition) ||
    !isHtmlLikeContentType(contentType)
  ) {
    await cancelResponseBody(response);
    return finalUrl;
  }

  const html = await response.text();
  const countdownConfig = parseCountdownLandingConfig(html, finalUrl);
  if (!countdownConfig) {
    return finalUrl;
  }

  if (countdownConfig.hasCaptcha) {
    throw new MirrorActionRequiredError(
      "This mirror now requires captcha confirmation. Open it in the embedded browser and finish the captcha there.",
      {
        code: "captcha_required",
        actionUrl: finalUrl,
        userMessage:
          "This mirror needs captcha confirmation before F95Launcher can continue. Finish the captcha, then retry the install.",
      },
    );
  }

  if (countdownConfig.hasPassword) {
    throw new Error(
      "Password-protected mirrors are not supported for automatic install yet.",
    );
  }

  const requestBody = new URLSearchParams({
    op: "download2",
    id: countdownConfig.code,
    rand: countdownConfig.rand || "",
    referer: countdownConfig.referer || finalUrl,
    method_free: countdownConfig.freeMethod || "",
    method_premium: countdownConfig.premiumMethod || "",
    g_captch__a: "1",
  }).toString();

  const countdownResponse = await fetchWithSession(session, finalUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      referer: countdownConfig.referer || finalUrl,
      "x-requested-with": "XMLHttpRequest",
    },
    body: requestBody,
  });

  if (!countdownResponse.ok) {
    await cancelResponseBody(countdownResponse);
    throw new Error(
      `Mirror download handshake failed with HTTP ${countdownResponse.status}.`,
    );
  }

  const payload = await countdownResponse.json().catch(() => null);
  const resolvedPayloadUrl = buildAbsoluteUrl(
    finalUrl,
    decodeURIComponent(String(payload?.url || "")),
  );

  if (resolvedPayloadUrl) {
    return resolvedPayloadUrl;
  }

  if (payload?.error) {
    throw new Error(String(payload.error));
  }

  return finalUrl;
}

function resolveKnownFileHostUrl(rawUrl) {
  const parsedUrl = new URL(rawUrl);
  const hostname = normalizeHostname(parsedUrl.hostname);

  if (hostname === "pixeldrain.com") {
    const fileMatch = parsedUrl.pathname.match(/^\/u\/([^/?#]+)/i);
    if (fileMatch) {
      const directUrl = new URL(
        `https://pixeldrain.com/api/file/${fileMatch[1]}`,
      );
      directUrl.searchParams.set("download", "");
      return directUrl.toString();
    }

    const apiMatch = parsedUrl.pathname.match(/^\/api\/file\/([^/?#]+)/i);
    if (apiMatch) {
      parsedUrl.searchParams.set("download", "");
      return parsedUrl.toString();
    }

    const listMatch = parsedUrl.pathname.match(/^\/l\/([^/?#]+)/i);
    if (listMatch) {
      throw new Error(
        "Pixeldrain list mirrors are not supported yet. Pick a single-file mirror or open it in the embedded browser.",
      );
    }
  }

  return rawUrl;
}

async function resolveHtmlLandingDownloadUrl(
  session,
  rawUrl,
  seenUrls = new Set(),
) {
  if (!rawUrl || seenUrls.has(rawUrl)) {
    return rawUrl;
  }

  seenUrls.add(rawUrl);

  const response = await fetchWithSession(session, rawUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    return response.url || rawUrl;
  }

  const finalUrl = response.url || rawUrl;
  const contentType = response.headers.get("content-type") || "";
  const contentDisposition = response.headers.get("content-disposition") || "";

  if (
    /attachment/i.test(contentDisposition) ||
    !isHtmlLikeContentType(contentType)
  ) {
    await cancelResponseBody(response);
    return finalUrl;
  }

  const html = await response.text();
  const candidates = extractHtmlDownloadCandidates(finalUrl, html);
  if (candidates.length === 0) {
    return finalUrl;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = resolveKnownFileHostUrl(candidate.url);
    if (!normalizedCandidate || seenUrls.has(normalizedCandidate)) {
      continue;
    }

    const resolvedCandidate = await resolveHtmlLandingDownloadUrl(
      session,
      normalizedCandidate,
      seenUrls,
    );
    if (resolvedCandidate && resolvedCandidate !== finalUrl) {
      return resolvedCandidate;
    }
  }

  return finalUrl;
}

async function prepareF95DownloadUrl(session, rawUrl) {
  const parsedUrl = new URL(rawUrl);
  let resolvedUrl = rawUrl;

  if (
    normalizeHostname(parsedUrl.hostname) === "f95zone.to" &&
    parsedUrl.pathname.includes("/masked/")
  ) {
    resolvedUrl = await resolveMaskedF95Url(session, rawUrl);
  }

  resolvedUrl = await resolveGoogleDriveUrl(session, resolvedUrl);

  const resolvedParsedUrl = new URL(resolvedUrl);
  const resolvedHostname = normalizeHostname(resolvedParsedUrl.hostname);

  if (resolvedHostname === "mega.nz" || resolvedHostname === "mega.io") {
    throw new Error(
      "MEGA mirrors are not supported for automatic install yet. Open the mirror in the embedded browser and download it manually.",
    );
  }

  resolvedUrl = resolveKnownFileHostUrl(resolvedUrl);
  resolvedUrl = await resolveGofileUrl(session, resolvedUrl);
  resolvedUrl = await resolveCountdownLandingDownloadUrl(session, resolvedUrl);
  resolvedUrl = await resolveHtmlLandingDownloadUrl(session, resolvedUrl);
  resolvedUrl = resolveKnownFileHostUrl(resolvedUrl);

  return {
    requestedUrl: rawUrl,
    resolvedUrl,
    sourceHost: normalizeHostname(new URL(resolvedUrl).hostname),
  };
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
  DownloadValidationError,
  MirrorActionRequiredError,
  detectArchiveTypeFromBuffer,
  inspectDownloadedPackage,
  looksLikeHtmlDocument,
  normalizeHostname,
  normalizeEngineLabel,
  parseF95ThreadTitle,
  parseCountdownLandingConfig,
  prepareF95DownloadUrl,
  extractHtmlDownloadCandidates,
  extractGofileContentId,
  extractGoogleDriveConfirmUrl,
  extractGoogleDriveDirectUrlFromHtml,
  extractGoogleDriveFileId,
  generateGofileWebsiteToken,
  resolveCountdownLandingDownloadUrl,
  resolveGofileUrl,
  resolveGoogleDriveUrl,
  resolveHtmlLandingDownloadUrl,
  resolveKnownFileHostUrl,
  sanitizeF95ThreadTitle,
};
