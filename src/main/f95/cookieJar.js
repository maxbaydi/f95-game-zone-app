/**
 * In-memory cookie jar shaped like Electron's `session.cookies` API plus a
 * `session`-like object whose `fetch` goes through `fetchWithCookieJar`.
 *
 * Used outside Electron (scripts/check-mirrors.js, tests) so the mirror
 * resolvers and the transfer pipeline run the exact same code path as the
 * app, only with Node's fetch and this jar instead of Chromium's.
 *
 * Cookie semantics follow RFC 6265 closely enough for file hosts: domain
 * cookies match subdomains, host-only cookies do not, paths are prefix
 * matched, `Secure` cookies only travel over https and expired cookies are
 * ignored.
 */

const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/\.$/, "");
}

function safeParseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

/**
 * RFC 6265 §5.1.4 default-path.
 * @param {string} pathname
 */
function defaultCookiePath(pathname) {
  const value = String(pathname || "");
  if (!value.startsWith("/")) {
    return "/";
  }
  const lastSlash = value.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : value.slice(0, lastSlash);
}

function domainMatches(hostname, cookie) {
  const host = normalizeDomain(hostname);
  const domain = normalizeDomain(cookie.domain);
  if (!host || !domain) {
    return false;
  }
  if (cookie.hostOnly) {
    return host === domain;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(requestPath, cookiePath) {
  const requested = String(requestPath || "/");
  const cookieValue = String(cookiePath || "/");
  if (requested === cookieValue) {
    return true;
  }
  if (!requested.startsWith(cookieValue)) {
    return false;
  }
  return cookieValue.endsWith("/") || requested.charAt(cookieValue.length) === "/";
}

function isExpired(cookie, nowSeconds) {
  const expiration = Number(cookie.expirationDate) || 0;
  return expiration > 0 && expiration <= nowSeconds;
}

/**
 * Parse one `Set-Cookie` header value.
 * @param {string} headerValue
 * @param {string} requestUrl
 * @returns {{name: string, value: string, domain: string, hostOnly: boolean, path: string, secure: boolean, httpOnly: boolean, expirationDate: number} | null}
 */
function parseSetCookieHeader(headerValue, requestUrl) {
  const text = String(headerValue || "").trim();
  if (!text) {
    return null;
  }

  const parsedUrl = safeParseUrl(requestUrl);
  const [pair, ...attributes] = text.split(";");
  const separatorIndex = pair.indexOf("=");
  const name = (separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair).trim();
  const value = separatorIndex >= 0 ? pair.slice(separatorIndex + 1).trim() : "";
  if (!name) {
    return null;
  }

  const cookie = {
    name,
    value,
    domain: normalizeDomain(parsedUrl?.hostname || ""),
    hostOnly: true,
    path: defaultCookiePath(parsedUrl?.pathname || "/"),
    secure: false,
    httpOnly: false,
    expirationDate: 0,
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValueParts] = attribute.split("=");
    const key = String(rawKey || "").trim().toLowerCase();
    const attributeValue = rawValueParts.join("=").trim();
    if (key === "domain" && attributeValue) {
      cookie.domain = normalizeDomain(attributeValue);
      cookie.hostOnly = false;
    } else if (key === "path" && attributeValue.startsWith("/")) {
      cookie.path = attributeValue;
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "httponly") {
      cookie.httpOnly = true;
    } else if (key === "max-age" && /^-?\d+$/.test(attributeValue)) {
      cookie.expirationDate = Math.floor(Date.now() / 1000) + Number(attributeValue);
    } else if (key === "expires" && attributeValue && cookie.expirationDate === 0) {
      const parsed = Date.parse(attributeValue);
      if (Number.isFinite(parsed)) {
        cookie.expirationDate = Math.floor(parsed / 1000);
      }
    }
  }

  return cookie;
}

/**
 * Parse a Netscape `cookies.txt` export (browser extensions, curl, yt-dlp).
 * @param {string} text
 */
function parseNetscapeCookies(text) {
  const cookies = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) {
      continue;
    }
    let httpOnly = false;
    if (/^#HttpOnly_/i.test(line)) {
      httpOnly = true;
      line = line.replace(/^#HttpOnly_/i, "");
    } else if (line.startsWith("#")) {
      continue;
    }

    const fields = line.split("\t");
    if (fields.length < 6) {
      continue;
    }
    const [rawDomain, includeSubdomains, path, secureFlag, expiration, name, ...valueParts] =
      fields;
    const domain = normalizeDomain(rawDomain);
    if (!domain || !name) {
      continue;
    }

    cookies.push({
      domain,
      hostOnly: !(String(includeSubdomains).toUpperCase() === "TRUE" || rawDomain.startsWith(".")),
      path: path && path.startsWith("/") ? path : "/",
      secure: String(secureFlag).toUpperCase() === "TRUE",
      expirationDate: Number(expiration) || 0,
      name: name.trim(),
      value: valueParts.join("\t"),
      httpOnly,
    });
  }
  return cookies;
}

/**
 * @param {Array<any>} [initialCookies]
 */
function createCookieJar(initialCookies = []) {
  /** @type {Map<string, any>} */
  const store = new Map();

  const keyOf = (cookie) =>
    `${normalizeDomain(cookie.domain)}|${cookie.path || "/"}|${cookie.name}`;

  const toRecord = (input) => {
    const parsedUrl = safeParseUrl(input.url);
    const explicitDomain = normalizeDomain(input.domain);
    const domain = explicitDomain || normalizeDomain(parsedUrl?.hostname || "");
    if (!domain || !input.name) {
      throw new Error("A cookie needs a name and a domain or url.");
    }
    return {
      name: String(input.name),
      value: String(input.value ?? ""),
      domain,
      hostOnly:
        typeof input.hostOnly === "boolean"
          ? input.hostOnly
          : !explicitDomain,
      path:
        typeof input.path === "string" && input.path.startsWith("/")
          ? input.path
          : parsedUrl
            ? defaultCookiePath(parsedUrl.pathname)
            : "/",
      secure: Boolean(input.secure),
      httpOnly: Boolean(input.httpOnly),
      expirationDate: Number(input.expirationDate) || 0,
    };
  };

  const jar = {
    /**
     * @param {{url?: string, name?: string, domain?: string}} [filter]
     * @returns {Promise<Array<any>>}
     */
    async get(filter = {}) {
      const nowSeconds = Date.now() / 1000;
      const parsedUrl = filter.url ? safeParseUrl(filter.url) : null;
      const results = [];
      for (const cookie of store.values()) {
        if (isExpired(cookie, nowSeconds)) {
          continue;
        }
        if (filter.name && cookie.name !== filter.name) {
          continue;
        }
        if (filter.domain && normalizeDomain(filter.domain) !== cookie.domain) {
          continue;
        }
        if (parsedUrl) {
          if (!domainMatches(parsedUrl.hostname, cookie)) {
            continue;
          }
          if (!pathMatches(parsedUrl.pathname || "/", cookie.path)) {
            continue;
          }
          if (cookie.secure && parsedUrl.protocol !== "https:") {
            continue;
          }
        }
        results.push({ ...cookie });
      }
      return results;
    },
    /**
     * @param {{url?: string, name: string, value?: string, domain?: string, path?: string, secure?: boolean, httpOnly?: boolean, expirationDate?: number, hostOnly?: boolean}} input
     */
    async set(input) {
      const record = toRecord(input);
      store.set(keyOf(record), record);
    },
    /**
     * @param {string} url
     * @param {string} name
     */
    async remove(url, name) {
      const parsedUrl = safeParseUrl(url);
      for (const [key, cookie] of store.entries()) {
        if (cookie.name !== name) {
          continue;
        }
        if (parsedUrl && !domainMatches(parsedUrl.hostname, cookie)) {
          continue;
        }
        store.delete(key);
      }
    },
    /** @returns {Array<any>} */
    list() {
      return Array.from(store.values(), (cookie) => ({ ...cookie }));
    },
    /** @param {Array<any>} cookies */
    load(cookies) {
      for (const cookie of cookies || []) {
        const record = toRecord(cookie);
        store.set(keyOf(record), record);
      }
    },
  };

  jar.load(initialCookies);
  return jar;
}

/**
 * Electron-session lookalike for Node: `{cookies, fetch}`.
 *
 * `fetch` goes through `fetchWithCookieJar` from hosts/common.js (required
 * lazily to avoid a module cycle), adds a browser identity when the caller
 * did not set one and reports every response to `onResponse` so callers can
 * capture fixtures.
 *
 * @param {{cookies?: Array<any>, userAgent?: string, acceptLanguage?: string, onResponse?: (info: {url: string, requestUrl: string, method: string, status: number, response: Response}) => void}} [input]
 */
function createCookieJarSession(input = {}) {
  const common = require("./hosts/common");
  const jar = createCookieJar(input.cookies || []);
  const userAgent = input.userAgent || common.BROWSER_USER_AGENT;
  const acceptLanguage = input.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE;

  const session = {
    cookies: jar,
    /**
     * @param {string} url
     * @param {any} [init]
     */
    async fetch(url, init = {}) {
      const headers = new Headers(init?.headers || {});
      if (!headers.has("user-agent")) {
        headers.set("user-agent", userAgent);
      }
      if (!headers.has("accept-language")) {
        headers.set("accept-language", acceptLanguage);
      }
      const method = String(init?.method || "GET").toUpperCase();
      const response = await common.fetchWithCookieJar(session, url, {
        ...init,
        headers,
      });
      if (typeof input.onResponse === "function") {
        try {
          input.onResponse({
            url: response.url || String(url),
            requestUrl: String(url),
            method,
            status: Number(response.status) || 0,
            response,
          });
        } catch {
          // Observers must never break the request.
        }
      }
      return response;
    },
  };

  return session;
}

module.exports = {
  createCookieJar,
  createCookieJarSession,
  defaultCookiePath,
  domainMatches,
  parseNetscapeCookies,
  parseSetCookieHeader,
  pathMatches,
};
