/**
 * Resolver session for Electron: wraps an Electron `session` so the mirror
 * resolvers, the browser-step flow and the transfer see the same network as
 * the embedded browser window.
 *
 * Verified on Electron 37 (2026-09-26, webRequest logging):
 *  - `session.fetch` from the main process sends **no cookies** (not even
 *    with `credentials: "include"`) and does not persist Set-Cookie;
 *  - `session.cookies.get({url})` misses domain cookies such as
 *    `.bzzhr.to`'s `cf_clearance`;
 *  - `session.fetch` rejects `redirect: "manual"` ("Redirect was cancelled"),
 *    fails a cross-origin redirect after a POST (net::ERR_FAILED) and blocks
 *    any request carrying a `referer` header (net::ERR_BLOCKED_BY_CLIENT).
 *
 * `net.request` has none of these limits, so every request goes through it:
 * cookies of the partition matching the URL (RFC 6265 rules shared with
 * ./cookieJar.js) are sent in the Cookie header, Set-Cookie answers are
 * stored back, redirects follow the `redirect` option and the response is
 * exposed as a WHATWG Response for the shared resolver code.
 *
 * The pure helpers are exported for unit tests; Electron is required lazily
 * so the module loads outside Electron.
 */
const { Readable } = require("stream");

const { domainMatches, pathMatches } = require("./cookieJar");
const { safeParseUrl, storeResponseCookies } = require("./hosts/common");

const debugNet = process.env.F95_DEBUG_NET
  ? (...args) => console.log("[electronSession]", ...args)
  : () => {};

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
 * One HTTP request through Electron's net.request, answered as a Response.
 * `init.redirect` "follow" (default) lets Chromium follow; "manual" returns
 * the first 3xx with its `location`; "error" rejects on a redirect.
 * @param {any} session
 * @param {string} url
 * @param {any} init
 * @returns {Promise<Response>}
 */
function requestViaNet(session, url, init) {
  const { net } = require("electron");
  const redirectMode =
    init?.redirect === "manual" || init?.redirect === "error" ? init.redirect : "follow";
  return new Promise((resolve, reject) => {
    let settled = false;
    let finalUrl = url;
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
      redirect: redirectMode,
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
      const onAbort = () => {
        request.abort();
        const error = new Error("The request was aborted.");
        error.name = "AbortError";
        finish(reject, error);
      };
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
    }
    request.on("redirect", (statusCode, method, redirectUrl, responseHeaders) => {
      debugNet("redirect", statusCode, method, redirectUrl.slice(0, 100));
      if (redirectMode === "manual") {
        const response = new Response(null, {
          status: statusCode,
          headers: /** @type {any} */ ({
            ...headersToObject(responseHeaders),
            location: redirectUrl,
          }),
        });
        Object.defineProperty(response, "url", { value: finalUrl, configurable: true });
        finish(resolve, response);
        request.abort();
        return;
      }
      finalUrl = redirectUrl;
      request.followRedirect();
    });
    request.on("response", (incoming) => {
      const status = Number(incoming.statusCode) || 0;
      debugNet("response", status, finalUrl.slice(0, 100));
      const body =
        status === 204 || status === 304
          ? null
          : Readable.toWeb(/** @type {any} */ (incoming));
      const response = new Response(/** @type {any} */ (body), {
        status,
        headers: /** @type {any} */ (headersToObject(incoming.headers)),
      });
      Object.defineProperty(response, "url", { value: finalUrl, configurable: true });
      Object.defineProperty(response, "redirected", {
        value: finalUrl !== url,
        configurable: true,
      });
      finish(resolve, response);
    });
    request.on("error", (error) => {
      debugNet("error", error.message, url.slice(0, 100));
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
 * @param {{transport?: (session: any, url: string, init: any) => Promise<Response>}} [options]
 * @returns {{raw: any, cookies: {get: Function, set: Function, remove: Function}, getUserAgent: () => string, fetch: (url: string, init?: any) => Promise<Response>}}
 */
function createElectronResolverSession(session, options = {}) {
  const transport = options.transport || requestViaNet;
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
      if (!headers.has("user-agent") && typeof session.getUserAgent === "function") {
        headers.set("user-agent", session.getUserAgent());
      }
      const matching = selectCookiesForUrl(await readAllCookies(session), url);
      if (matching.length > 0) {
        headers.set("cookie", mergeCookieHeader(headers.get("cookie") || "", matching));
      }
      debugNet(
        "request",
        String(init?.method || "GET"),
        url.slice(0, 100),
        "redirect=",
        init?.redirect || "follow",
        "cookies=",
        matching.map((cookie) => cookie.name).join(","),
      );
      const response = await transport(session, url, { ...init, headers });
      debugNet("  ->", response.status, (response.url || url).slice(0, 100));
      // Keep the jar in sync: Chromium does not persist Set-Cookie for us here.
      await storeResponseCookies({ cookies }, response, response.url || url);
      return response;
    },
  };
}

module.exports = {
  createElectronResolverSession,
  mergeCookieHeader,
  requestViaNet,
  selectCookiesForUrl,
};
