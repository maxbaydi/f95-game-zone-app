/**
 * Resolver session for Electron: wraps an Electron `session` so the mirror
 * resolvers, the browser-step flow and the transfer see the same network as
 * the embedded browser window.
 *
 * Verified on Electron 37 (2026-09-26): `session.fetch` and `net.request`
 * issued from the main process send **no cookies at all** (not even with
 * `credentials: "include"`), and `session.cookies.get({url})` misses domain
 * cookies such as `.bzzhr.to`'s `cf_clearance`. So a Cloudflare check solved
 * in the window never reached the downloader. This wrapper:
 *
 * 1. reads every cookie of the session and attaches the ones matching the
 *    request URL (RFC 6265 rules from ./cookieJar.js) in the Cookie header;
 * 2. exposes `cookies.get/set/remove` with the same URL matching so host
 *    resolvers (Gofile's stored account, ...) find domain cookies too;
 * 3. serves `redirect: "manual"` through `net.request` (whose `redirect`
 *    event exposes the Location) because `session.fetch` rejects it with
 *    "Redirect was cancelled".
 *
 * The pure helpers are exported for unit tests; Electron is required lazily
 * so the module loads outside Electron.
 */
const { Readable } = require("stream");

const { domainMatches, pathMatches } = require("./cookieJar");
const { safeParseUrl } = require("./hosts/common");

/**
 * Cookies of `all` that a browser would send to `url`.
 * @param {Array<any>} all
 * @param {string} url
 */
function selectCookiesForUrl(all, url) {
  const parsedUrl = safeParseUrl(url);
  if (!parsedUrl) {
    return [];
  }
  const nowSeconds = Date.now() / 1000;
  return (all || []).filter((cookie) => {
    if (!cookie || !cookie.name) {
      return false;
    }
    const expiration = Number(cookie.expirationDate) || 0;
    if (expiration > 0 && expiration <= nowSeconds) {
      return false;
    }
    if (cookie.secure && parsedUrl.protocol !== "https:") {
      return false;
    }
    if (!domainMatches(parsedUrl.hostname, { domain: cookie.domain, hostOnly: cookie.hostOnly })) {
      return false;
    }
    return pathMatches(parsedUrl.pathname || "/", cookie.path || "/");
  });
}

/**
 * Merge cookies into an existing Cookie header without duplicating names.
 * @param {string} existing
 * @param {Array<{name: string, value: string}>} cookies
 */
function mergeCookieHeader(existing, cookies) {
  const seen = new Set();
  const parts = [];
  for (const part of String(existing || "").split(";")) {
    const pair = part.trim();
    if (!pair) {
      continue;
    }
    seen.add(pair.split("=")[0].trim());
    parts.push(pair);
  }
  for (const cookie of cookies || []) {
    const name = String(cookie?.name || "").trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    parts.push(`${name}=${String(cookie.value ?? "")}`);
  }
  return parts.join("; ");
}

async function readAllCookies(session) {
  try {
    return (await session.cookies.get({})) || [];
  } catch {
    return [];
  }
}

function headersToObject(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    result[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return result;
}

/**
 * `redirect: "manual"` through net.request: the first 3xx is returned as a
 * Response carrying `location`; any other answer is streamed through.
 * @param {any} session
 * @param {string} url
 * @param {any} init
 * @returns {Promise<Response>}
 */
function requestWithManualRedirect(session, url, init) {
  const { net } = require("electron");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        callback(value);
      }
    };
    const request = net.request({
      url,
      method: String(init?.method || "GET").toUpperCase(),
      session,
      useSessionCookies: false,
      redirect: "manual",
    });
    const headers = new Headers(init?.headers || {});
    headers.forEach((value, key) => {
      try {
        request.setHeader(key, value);
      } catch {
        // Chromium refuses a few headers (e.g. content-length); ignore.
      }
    });
    if (init?.signal) {
      init.signal.addEventListener(
        "abort",
        () => {
          request.abort();
          const error = new Error("The request was aborted.");
          error.name = "AbortError";
          finish(reject, error);
        },
        { once: true },
      );
    }
    request.on("redirect", (statusCode, method, redirectUrl, responseHeaders) => {
      const response = new Response(null, {
        status: statusCode,
        headers: { ...headersToObject(responseHeaders), location: redirectUrl },
      });
      Object.defineProperty(response, "url", { value: url, configurable: true });
      finish(resolve, response);
      request.abort();
    });
    request.on("response", (incoming) => {
      const status = Number(incoming.statusCode) || 0;
      const body =
        status === 204 || status === 304
          ? null
          : Readable.toWeb(/** @type {any} */ (incoming));
      const response = new Response(/** @type {any} */ (body), {
        status,
        headers: /** @type {any} */ (headersToObject(incoming.headers)),
      });
      Object.defineProperty(response, "url", { value: url, configurable: true });
      finish(resolve, response);
    });
    request.on("error", (error) => {
      finish(reject, error);
    });
    if (init?.body !== undefined && init?.body !== null) {
      request.write(typeof init.body === "string" ? init.body : Buffer.from(init.body));
    }
    request.end();
  });
}

/**
 * @param {any} session Electron session
 * @returns {{raw: any, cookies: {get: Function, set: Function, remove: Function}, getUserAgent: () => string, fetch: (url: string, init?: any) => Promise<Response>}}
 */
function createElectronResolverSession(session) {
  const cookies = {
    /** @param {{url?: string, name?: string, domain?: string}} [filter] */
    async get(filter = {}) {
      const all = await readAllCookies(session);
      let selected = filter.url ? selectCookiesForUrl(all, filter.url) : all;
      if (filter.name) {
        selected = selected.filter((cookie) => cookie.name === filter.name);
      }
      if (filter.domain) {
        const wanted = String(filter.domain).replace(/^\./, "").toLowerCase();
        selected = selected.filter(
          (cookie) => String(cookie.domain || "").replace(/^\./, "").toLowerCase() === wanted,
        );
      }
      return selected;
    },
    set: (cookie) => session.cookies.set(cookie),
    remove: (url, name) => session.cookies.remove(url, name),
  };

  return {
    raw: session,
    cookies,
    getUserAgent: () =>
      typeof session.getUserAgent === "function" ? session.getUserAgent() : "",
    async fetch(url, init = {}) {
      const headers = new Headers(init?.headers || {});
      const matching = selectCookiesForUrl(await readAllCookies(session), url);
      if (matching.length > 0) {
        headers.set("cookie", mergeCookieHeader(headers.get("cookie") || "", matching));
      }
      const request = { ...init, headers };
      if (init?.redirect === "manual") {
        return requestWithManualRedirect(session, url, request);
      }
      return session.fetch(url, request);
    },
  };
}

module.exports = {
  createElectronResolverSession,
  mergeCookieHeader,
  requestWithManualRedirect,
  selectCookiesForUrl,
};
