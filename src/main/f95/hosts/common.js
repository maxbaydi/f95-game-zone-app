/**
 * Shared helpers for mirror host resolvers and the direct transfer pipeline.
 *
 * Everything in here is dependency-free (Node built-ins + global fetch) so the
 * host modules can be unit-tested with stubbed `session.fetch` responses.
 */

const { parseSetCookieHeader } = require("../cookieJar");

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_AFTER_MS = 60000;
const BROWSER_ACTION_HINT =
  "Open it in the built-in browser, finish the step there, then retry the download.";

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

const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "7z",
  "rar",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "zst",
]);

const INSTALLABLE_FILE_EXTENSIONS = new Set(["exe", "apk", "jar", "swf"]);

const NOISE_FILE_EXTENSIONS = new Set([
  "txt",
  "nfo",
  "md",
  "url",
  "html",
  "htm",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "mp4",
  "webm",
  "pdf",
  "sfv",
  "md5",
  "sha1",
  "sha256",
]);

const PLATFORM_KEYWORDS = {
  windows: [/(^|[^a-z])(win(dows)?|pc)([^a-z]|$)/i, /\.exe$/i],
  linux: [/(^|[^a-z])linux([^a-z]|$)/i],
  mac: [/(^|[^a-z])(mac|macos|osx)([^a-z]|$)/i, /\.dmg$/i],
  android: [/(^|[^a-z])android([^a-z]|$)/i, /\.apk$/i],
};

class MirrorActionRequiredError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, actionUrl?: string, userMessage?: string, hostLabel?: string}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "MirrorActionRequiredError";
    this.code = options.code || "mirror_action_required";
    this.actionUrl = options.actionUrl || "";
    this.userMessage = options.userMessage || message;
    this.hostLabel = options.hostLabel || "";
    this.retryable = false;
  }
}

class MirrorError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, status?: number, retryable?: boolean, retryAfterMs?: number, userMessage?: string, actionUrl?: string}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "MirrorError";
    this.code = options.code || "mirror_error";
    this.status = Number(options.status) || 0;
    this.retryable = Boolean(options.retryable);
    this.retryAfterMs = Number(options.retryAfterMs) || 0;
    this.userMessage = options.userMessage || message;
    this.actionUrl = options.actionUrl || "";
  }
}

class DownloadCancelledError extends Error {
  constructor(message = "Download cancelled.") {
    super(message);
    this.name = "DownloadCancelledError";
    this.code = "cancelled";
    this.retryable = false;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .replace(/^www\./i, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeParseUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function hostnameOf(value) {
  const parsedUrl = safeParseUrl(value);
  return parsedUrl ? normalizeHostname(parsedUrl.hostname) : "";
}

/**
 * True when `hostname` is one of `domains` or a subdomain of one of them.
 * @param {string} hostname
 * @param {string[]} domains
 */
function hostMatchesDomain(hostname, domains) {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) {
    return false;
  }

  return (domains || []).some((domain) => {
    const normalizedDomain = normalizeHostname(domain);
    return (
      normalizedHost === normalizedDomain ||
      normalizedHost.endsWith(`.${normalizedDomain}`)
    );
  });
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

function decodeCodePoint(codePoint) {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return "";
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

function safeDecodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d{1,7});/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) =>
      decodeCodePoint(Number.parseInt(code, 16)),
    );
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

function stripHtmlTags(html) {
  return normalizeText(
    safeDecodeHtmlEntities(
      String(html || "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function buildAbsoluteUrl(baseUrl, rawValue) {
  const normalizedValue = safeDecodeHtmlEntities(rawValue).trim();
  if (!normalizedValue || /^javascript:/i.test(normalizedValue)) {
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
  const attributePattern =
    /([:@a-zA-Z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match = null;

  while ((match = attributePattern.exec(String(rawAttributes || "")))) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[String(match[1] || "").toLowerCase()] =
      safeDecodeHtmlEntities(value);
  }

  return attributes;
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

/**
 * Collect every anchor (`<a href>`) on a page with its visible text.
 * @param {string} html
 * @param {string} pageUrl
 */
function extractAnchors(html, pageUrl) {
  const anchors = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match = null;

  while ((match = anchorPattern.exec(String(html || "")))) {
    const attributes = parseHtmlTagAttributes(match[1]);
    const url = buildAbsoluteUrl(pageUrl, attributes.href || "");
    if (!url) {
      continue;
    }

    anchors.push({
      url,
      attributes,
      text: stripHtmlTags(match[2]),
    });
  }

  return anchors;
}

/**
 * Parse every `<form>` on a page into a submit-ready description.
 * @param {string} html
 * @param {string} pageUrl
 */
function extractHtmlForms(html, pageUrl) {
  const forms = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch = null;

  while ((formMatch = formPattern.exec(String(html || "")))) {
    const attributes = parseHtmlTagAttributes(formMatch[1]);
    const innerHtml = formMatch[2] || "";
    const inputs = [];
    const fields = {};
    const inputPattern = /<(input|button|select|textarea)\b([^>]*)>/gi;
    let inputMatch = null;

    while ((inputMatch = inputPattern.exec(innerHtml))) {
      const tag = inputMatch[1].toLowerCase();
      const inputAttributes = parseHtmlTagAttributes(inputMatch[2]);
      const name = String(inputAttributes.name || "").trim();
      if (!name) {
        continue;
      }

      const defaultType =
        tag === "button" ? "submit" : tag === "input" ? "text" : tag;
      const type = String(inputAttributes.type || defaultType).toLowerCase();
      const value = inputAttributes.value || "";
      inputs.push({ tag, name, type, value, attributes: inputAttributes });

      if (
        ["submit", "button", "image", "reset", "file", "checkbox", "radio"].includes(
          type,
        )
      ) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(fields, name)) {
        fields[name] = value;
      }
    }

    forms.push({
      id: attributes.id || "",
      name: attributes.name || "",
      attributes,
      action: buildAbsoluteUrl(pageUrl, attributes.action || "") || pageUrl,
      method: String(attributes.method || "GET").toUpperCase(),
      fields,
      inputs,
      innerHtml,
    });
  }

  return forms;
}

function detectCaptchaKind(html) {
  const text = String(html || "");
  if (/cf-turnstile|challenges\.cloudflare\.com\/turnstile/i.test(text)) {
    return "turnstile";
  }
  if (/g-recaptcha|google\.com\/recaptcha|recaptcha\/api\.js/i.test(text)) {
    return "recaptcha";
  }
  if (/h-captcha|hcaptcha\.com/i.test(text)) {
    return "hcaptcha";
  }
  return "";
}

function looksLikeCloudflareChallenge(html) {
  return /cf-browser-verification|challenge-platform|cf_chl_opt|<title>\s*just a moment/i.test(
    String(html || ""),
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

function getHeader(response, name) {
  try {
    const value = response?.headers?.get?.(name);
    return value === null || value === undefined ? "" : String(value);
  } catch {
    return "";
  }
}

function isFileResponse(response) {
  return (
    /attachment/i.test(getHeader(response, "content-disposition")) ||
    !isHtmlLikeContentType(getHeader(response, "content-type"))
  );
}

async function cancelResponseBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === "function") {
      await response.body.cancel();
    }
  } catch {
    // Ignore body cancellation failures for consumed or auto-closed bodies.
  }
}

async function readResponseText(response, maxBytes = 0) {
  try {
    const text = await response.text();
    return maxBytes > 0 ? String(text || "").slice(0, maxBytes) : String(text || "");
  } catch {
    return "";
  }
}

async function readResponseJson(response) {
  try {
    if (typeof response?.json === "function") {
      return await response.json();
    }
    const text = await response.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function buildCookieHeader(session, url) {
  if (!session?.cookies?.get) {
    return "";
  }

  try {
    const cookies = await session.cookies.get({ url });
    return cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

const MAX_COOKIE_JAR_REDIRECTS = 20;

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

function readSetCookieHeaders(response) {
  try {
    const headers = response?.headers;
    if (!headers) {
      return [];
    }
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }
    const raw = headers.get("set-cookie");
    return raw ? [raw] : [];
  } catch {
    return [];
  }
}

/**
 * Persist the cookies a response sets into the session jar (Electron's
 * `session.cookies.set` or the Node jar from ../cookieJar.js).
 * @param {any} session
 * @param {Response} response
 * @param {string} requestUrl
 */
async function storeResponseCookies(session, response, requestUrl) {
  if (!session?.cookies?.set) {
    return;
  }
  for (const headerValue of readSetCookieHeaders(response)) {
    const cookie = parseSetCookieHeader(headerValue, requestUrl);
    if (!cookie) {
      continue;
    }
    const record = {
      url: requestUrl,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    };
    if (!cookie.hostOnly) {
      record.domain = cookie.domain;
    }
    if (cookie.expirationDate > 0) {
      record.expirationDate = cookie.expirationDate;
    }
    try {
      await session.cookies.set(record);
    } catch {
      // A cookie the jar refuses must not fail the request.
    }
  }
}

function isSameOrigin(leftUrl, rightUrl) {
  const left = safeParseUrl(leftUrl);
  const right = safeParseUrl(rightUrl);
  return Boolean(left && right && left.origin === right.origin);
}

/**
 * Global fetch with the session cookie jar attached manually.
 *
 * Redirects are followed hop by hop (like Chromium does for `session.fetch`)
 * so cookies set on an intermediate hop are sent on the next one and every
 * `Set-Cookie` ends up in the jar. `redirect: "manual"` returns the first
 * response untouched.
 * @param {any} session
 * @param {string} url
 * @param {any} [options]
 */
async function fetchWithCookieJar(session, url, options) {
  const { redirect = "follow", ...requestInit } = options || {};
  const headers = new Headers(requestInit.headers || {});
  let currentUrl = String(url);
  let method = String(requestInit.method || "GET").toUpperCase();
  let body = requestInit.body;

  for (let hop = 0; hop <= MAX_COOKIE_JAR_REDIRECTS; hop += 1) {
    const hopHeaders = new Headers(headers);
    const cookieHeader = await buildCookieHeader(session, currentUrl);
    if (cookieHeader && !hopHeaders.has("cookie")) {
      hopHeaders.set("cookie", cookieHeader);
    }

    const response = await fetch(currentUrl, {
      ...requestInit,
      method,
      body,
      headers: hopHeaders,
      redirect: redirect === "follow" ? "manual" : redirect,
    });
    await storeResponseCookies(session, response, currentUrl);

    if (redirect !== "follow" || !isRedirectStatus(response.status)) {
      return response;
    }
    const location = getHeader(response, "location");
    const nextUrl = location ? buildAbsoluteUrl(currentUrl, location) : "";
    if (!nextUrl) {
      return response;
    }
    await cancelResponseBody(response);

    const status = Number(response.status);
    if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-length");
      headers.delete("content-encoding");
    }
    if (!isSameOrigin(currentUrl, nextUrl)) {
      headers.delete("authorization");
      headers.delete("cookie");
    }
    currentUrl = nextUrl;
  }

  throw new MirrorError(
    `${hostnameOf(url) || "The mirror"} redirected too many times.`,
    { code: "too_many_redirects" },
  );
}

/**
 * Prefer Electron's `session.fetch` (Chromium network stack + cookie jar).
 * @param {any} session
 * @param {string} url
 * @param {any} [options]
 */
async function fetchWithSession(session, url, options) {
  if (session && typeof session.fetch === "function") {
    return session.fetch(url, options);
  }

  return fetchWithCookieJar(session, url, options);
}

function parseRetryAfterMs(value, nowMs = Date.now()) {
  const text = String(value || "").trim();
  if (!text) {
    return 0;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 1000);
  }

  const date = Date.parse(text);
  if (Number.isFinite(date)) {
    return Math.max(0, date - nowMs);
  }

  return 0;
}

function describeHttpStatus(status, hostLabel = "") {
  const who = hostLabel || "The mirror";
  if (status === 401 || status === 403) {
    return {
      code: "access_denied",
      retryable: false,
      message: `${who} refused access (HTTP ${status}). The link may have expired, be private or need a captcha — open it in the browser or pick another mirror.`,
    };
  }
  if (status === 404 || status === 410) {
    return {
      code: "not_found",
      retryable: false,
      message: `${who} says the file does not exist (HTTP ${status}). It was probably deleted — pick another mirror.`,
    };
  }
  if (status === 408) {
    return {
      code: "timeout",
      retryable: true,
      message: `${who} timed out (HTTP 408). Try again in a moment.`,
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      retryable: true,
      message: `${who} is rate-limiting downloads (HTTP 429). Wait a few minutes and retry, or pick another mirror.`,
    };
  }
  if (status === 509) {
    return {
      code: "bandwidth_exceeded",
      retryable: false,
      message: `${who} bandwidth or transfer quota is exceeded (HTTP 509). Try again later or pick another mirror.`,
    };
  }
  if (status >= 500) {
    return {
      code: "server_error",
      retryable: true,
      message: `${who} had a server error (HTTP ${status}). Try again later or pick another mirror.`,
    };
  }

  return {
    code: "http_error",
    retryable: false,
    message: `${who} request failed with HTTP ${status}.`,
  };
}

function createHttpError(response, hostLabel = "") {
  const status = Number(response?.status) || 0;
  const description = describeHttpStatus(status, hostLabel);
  return new MirrorError(description.message, {
    code: description.code,
    status,
    retryable: description.retryable,
    retryAfterMs: parseRetryAfterMs(getHeader(response, "retry-after")),
  });
}

function createNotFoundError(hostLabel, detail = "") {
  const who = hostLabel || "This mirror";
  return new MirrorError(
    `${who}: the file no longer exists${detail ? ` (${detail})` : ""}. Pick another mirror.`,
    { code: "not_found" },
  );
}

/**
 * Build a MirrorActionRequiredError with a consistent user message.
 * @param {string} hostLabel
 * @param {string} actionUrl
 * @param {string} reason
 * @param {string} [code]
 */
function createActionRequiredError(
  hostLabel,
  actionUrl,
  reason,
  code = "mirror_action_required",
) {
  const who = hostLabel || "This mirror";
  const userMessage = `${who} ${reason} ${BROWSER_ACTION_HINT}`;
  return new MirrorActionRequiredError(userMessage, {
    code,
    actionUrl,
    userMessage,
    hostLabel,
  });
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    error?.code === 20 ||
    /aborted|net::ERR_ABORTED/i.test(String(error?.message || ""))
  );
}

function isTransientError(error) {
  if (!error) {
    return false;
  }

  if (
    error instanceof MirrorActionRequiredError ||
    error instanceof DownloadCancelledError
  ) {
    return false;
  }

  if (typeof error.retryable === "boolean") {
    return error.retryable;
  }

  const message = String(error.message || "");
  const code = String(error.code || error.cause?.code || "");

  if (
    /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|UND_ERR_[A-Z_]+)$/.test(
      code,
    )
  ) {
    return true;
  }

  if (
    /net::ERR_(CONNECTION_(RESET|CLOSED|REFUSED|ABORTED|TIMED_OUT|FAILED)|TIMED_OUT|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|EMPTY_RESPONSE|HTTP2_[A-Z_]+|QUIC_PROTOCOL_ERROR|SSL_PROTOCOL_ERROR|PROXY_CONNECTION_FAILED|INCOMPLETE_CHUNKED_ENCODING|CONTENT_LENGTH_MISMATCH|SOCKET_NOT_CONNECTED)/i.test(
      message,
    )
  ) {
    return true;
  }

  if (error.name === "TypeError" && /fetch failed|network|terminated|socket/i.test(message)) {
    return true;
  }

  return /socket hang up|other side closed|premature close|ECONNRESET|ETIMEDOUT|terminated/i.test(
    message,
  );
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DownloadCancelledError();
  }
}

/**
 * Promise-based delay that rejects with DownloadCancelledError on abort.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DownloadCancelledError());
      return;
    }

    let timer = null;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DownloadCancelledError());
    };

    timer = setTimeout(
      () => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve();
      },
      Math.max(0, Number(ms) || 0),
    );
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * @param {number} attempt 1-based attempt that just failed
 * @param {{baseDelayMs?: number, maxDelayMs?: number, retryAfterMs?: number, jitter?: boolean}} [options]
 */
function computeBackoffDelay(attempt, options = {}) {
  const retryAfterMs = Number(options.retryAfterMs) || 0;
  if (retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }

  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15000;
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  if (options.jitter === false) {
    return capped;
  }

  return Math.round(capped * (0.8 + Math.random() * 0.4));
}

/**
 * Run `task` with exponential backoff for transient failures.
 * @template T
 * @param {(attempt: number) => Promise<T>} task
 * @param {{attempts?: number, baseDelayMs?: number, maxDelayMs?: number, signal?: AbortSignal, shouldRetry?: (error: any) => boolean, onRetry?: (info: {attempt: number, attempts: number, delayMs: number, error: any}) => void, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>}} [options]
 * @returns {Promise<T>}
 */
async function withRetry(task, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const shouldRetry = options.shouldRetry || isTransientError;
  const wait = options.sleep || sleep;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) {
        throw new DownloadCancelledError();
      }
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = computeBackoffDelay(attempt, {
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        retryAfterMs: error?.retryAfterMs,
      });
      if (typeof options.onRetry === "function") {
        options.onRetry({ attempt, attempts, delayMs, error });
      }
      await wait(delayMs, options.signal);
    }
  }

  throw lastError;
}

/**
 * Combine several abort signals and an optional timeout into one signal.
 * @param {Array<AbortSignal|null|undefined>} signals
 * @param {number} [timeoutMs]
 */
function linkAbortSignals(signals, timeoutMs = 0) {
  const controller = new AbortController();
  const cleanups = [];
  let timer = null;
  let timedOut = false;

  const abort = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  for (const signal of signals || []) {
    if (!signal) {
      continue;
    }
    if (signal.aborted) {
      abort(signal.reason);
      break;
    }
    const listener = () => abort(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", listener));
  }

  if (timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      timedOut = true;
      abort(
        new MirrorError("The request timed out.", {
          code: "timeout",
          retryable: true,
        }),
      );
    }, timeoutMs);
  }

  const stopTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    signal: controller.signal,
    abort,
    didTimeout: () => timedOut,
    stopTimer,
    dispose() {
      stopTimer();
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
  };
}

/**
 * Resolver context: a fetch bound to the Electron session with cancellation,
 * per-request timeouts and a status reporter.
 * @param {{session?: any, signal?: AbortSignal, onStatus?: (text: string) => void, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, requestTimeoutMs?: number, platformHint?: string, options?: Record<string, any>}} [input]
 */
function createResolverContext(input = {}) {
  const signal = input.signal || null;
  const wait = input.sleep || sleep;
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return {
    session: input.session || null,
    signal,
    platformHint: input.platformHint || "",
    options: input.options || {},
    /**
     * @param {string} url
     * @param {any} [options]
     */
    async fetch(url, options = {}) {
      throwIfAborted(signal);
      const { timeoutMs, ...fetchOptions } = options || {};
      const link = linkAbortSignals(
        [signal, fetchOptions.signal],
        timeoutMs ?? requestTimeoutMs,
      );

      try {
        return await fetchWithSession(input.session, url, {
          ...fetchOptions,
          signal: link.signal,
        });
      } catch (error) {
        if (signal?.aborted) {
          throw new DownloadCancelledError();
        }
        if (link.didTimeout()) {
          throw new MirrorError(
            `${hostnameOf(url) || "The mirror"} did not respond in time.`,
            { code: "timeout", retryable: true },
          );
        }
        throw error;
      } finally {
        link.dispose();
      }
    },
    report(text) {
      if (typeof input.onStatus === "function" && text) {
        try {
          input.onStatus(String(text));
        } catch {
          // Status reporting must never break resolution.
        }
      }
    },
    /** @param {number} ms */
    sleep(ms) {
      return wait(ms, signal || undefined);
    },
    /**
     * Overridden by the host registry: decides whether a URL produced by a
     * resolver should continue through the chain (known host) or be final.
     * @param {string} url
     * @returns {string | {url: string}}
     */
    continueOrFinal(url) {
      return { url };
    },
  };
}

function getFileExtension(name) {
  const match = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : "";
}

function isArchiveFileName(name) {
  const normalized = String(name || "").toLowerCase();
  return (
    ARCHIVE_EXTENSIONS.has(getFileExtension(normalized)) ||
    /\.tar\.(gz|bz2|xz|zst)$/.test(normalized)
  );
}

function isSplitArchivePart(name) {
  return /\.(part\d+\.rar|(7z|zip|rar)\.\d{3}|z\d{2}|r\d{2})$/i.test(
    String(name || ""),
  );
}

function normalizePlatformHint(value) {
  const hint = normalizeText(value).toLowerCase();
  if (!hint) {
    return "";
  }
  if (/android/.test(hint)) {
    return "android";
  }
  if (/\b(mac|osx|macos)\b/.test(hint)) {
    return "mac";
  }
  if (/\b(win|windows|pc)\b/.test(hint)) {
    return "windows";
  }
  if (/linux/.test(hint)) {
    return "linux";
  }
  return "";
}

function scoreFileCandidate(file, platform) {
  const name = String(file?.name || "");
  const extension = getFileExtension(name);
  let score = 0;

  if (isArchiveFileName(name)) {
    score += 1000;
  } else if (INSTALLABLE_FILE_EXTENSIONS.has(extension)) {
    score += 500;
  } else if (NOISE_FILE_EXTENSIONS.has(extension)) {
    score -= 1000;
  }

  if (platform) {
    for (const [platformId, patterns] of Object.entries(PLATFORM_KEYWORDS)) {
      const mentionsPlatform = patterns.some((pattern) => pattern.test(name));
      if (!mentionsPlatform) {
        continue;
      }
      score += platformId === platform ? 300 : -300;
    }
  }

  return score;
}

/**
 * Pick the most plausible game package from a multi-file mirror (folder,
 * list, archive set).
 * @template {{name?: string, size?: number}} T
 * @param {T[]} files
 * @param {{preferredName?: string, platformHint?: string}} [options]
 * @returns {T | null}
 */
function pickBestFile(files, options = {}) {
  const candidates = (Array.isArray(files) ? files : []).filter(
    (file) => file && String(file.name || "").trim(),
  );
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const preferredName = normalizeText(options.preferredName).toLowerCase();
  if (preferredName) {
    const exactMatch = candidates.find(
      (file) => normalizeText(file.name).toLowerCase() === preferredName,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  const platform = normalizePlatformHint(options.platformHint);
  return [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreFileCandidate(right, platform) - scoreFileCandidate(left, platform);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return (Number(right.size) || 0) - (Number(left.size) || 0);
  })[0];
}

/**
 * Throw a clear error when the picked file is one volume of a split archive.
 * @param {{name?: string} | null} file
 * @param {Array<{name?: string}>} files
 * @param {string} hostLabel
 */
function assertNotSplitArchive(file, files, hostLabel) {
  if (!file || !isSplitArchivePart(file.name)) {
    return;
  }

  const parts = (files || []).filter((entry) => isSplitArchivePart(entry?.name));
  if (parts.length < 2) {
    return;
  }

  throw new MirrorError(
    `${hostLabel || "This mirror"} holds a multi-part archive (${parts.length} volumes such as "${file.name}"). F95Launcher can only install single-file packages automatically — pick another mirror or download all parts manually.`,
    { code: "multi_part_archive" },
  );
}

module.exports = {
  ARCHIVE_EXTENSIONS,
  BROWSER_ACTION_HINT,
  BROWSER_USER_AGENT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DownloadCancelledError,
  MirrorActionRequiredError,
  MirrorError,
  TEXTUAL_MIME_TYPES,
  assertNotSplitArchive,
  buildAbsoluteUrl,
  buildCookieHeader,
  cancelResponseBody,
  computeBackoffDelay,
  createActionRequiredError,
  createHttpError,
  createNotFoundError,
  createResolverContext,
  decodeJavascriptEscapes,
  describeHttpStatus,
  detectCaptchaKind,
  extractAnchors,
  extractHtmlForms,
  extractHtmlTagAttributes,
  fetchWithCookieJar,
  fetchWithSession,
  getFileExtension,
  getHeader,
  getHostFamily,
  hostMatchesDomain,
  hostnameOf,
  isAbortError,
  isArchiveFileName,
  isFileResponse,
  isHtmlLikeContentType,
  isSameHostFamily,
  isSplitArchivePart,
  isTransientError,
  linkAbortSignals,
  looksLikeCloudflareChallenge,
  looksLikeHtmlDocument,
  normalizeHostname,
  normalizePlatformHint,
  normalizeText,
  parseBooleanAttribute,
  parseHtmlTagAttributes,
  parseRetryAfterMs,
  pickBestFile,
  readResponseJson,
  readResponseText,
  readTagAttribute,
  safeDecodeHtmlEntities,
  safeParseUrl,
  sleep,
  storeResponseCookies,
  stripHtmlTags,
  throwIfAborted,
  withRetry,
};
