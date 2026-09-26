/**
 * Helpers for stubbing `session.fetch` / `fetch` in download tests with real
 * WHATWG Response objects.
 */
const { ReadableStream } = require("node:stream/web");

/**
 * @param {{status?: number, url?: string, headers?: Record<string, string>, body?: any, json?: any}} [input]
 * @returns {Response}
 */
function createMockResponse(input = {}) {
  const headers = new Headers(input.headers || {});
  let body = input.body ?? null;
  if (input.json !== undefined) {
    body = JSON.stringify(input.json);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  if (typeof body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }

  const status = input.status ?? 200;
  const nullBodyStatus = [101, 204, 205, 304].includes(status);
  const response = new Response(/** @type {any} */ (nullBodyStatus ? null : body), {
    status,
    headers,
  });
  Object.defineProperty(response, "url", {
    value: input.url || "",
    configurable: true,
  });
  return response;
}

/**
 * Stream that emits the given chunks and then either closes or hangs.
 * @param {Array<Buffer | string>} chunks
 * @param {{hang?: boolean, error?: Error, onCancel?: () => void}} [options]
 */
function createChunkedStream(chunks, options = {}) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
        );
        return undefined;
      }
      if (options.error) {
        controller.error(options.error);
        return undefined;
      }
      if (options.hang) {
        return new Promise(() => {});
      }
      controller.close();
      return undefined;
    },
    cancel() {
      if (typeof options.onCancel === "function") {
        options.onCancel();
      }
    },
  });
}

/**
 * Route-based fake session. Each route is `[matcher, handler]` where matcher
 * is a string (exact URL), RegExp or predicate, and handler returns a
 * Response (or a plain object) for `(url, options, callIndex)`.
 * @param {Array<[string | RegExp | ((url: string, options: any) => boolean), (url: string, options: any, count: number) => any]>} routes
 */
function createRoutedSession(routes) {
  const calls = [];
  const hits = new Map();
  return {
    calls,
    cookies: {
      async set() {},
      async get() {
        return [];
      },
    },
    async fetch(url, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      calls.push({ url, method, headers: options.headers || {}, body: options.body });
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const [matcher, handler] = routes[routeIndex];
        const matches =
          typeof matcher === "string"
            ? matcher === url
            : matcher instanceof RegExp
              ? matcher.test(url)
              : matcher(url, options);
        if (matches) {
          const count = (hits.get(routeIndex) || 0) + 1;
          hits.set(routeIndex, count);
          return handler(url, { ...options, method }, count);
        }
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    },
  };
}

const noSleep = async () => {};

module.exports = {
  createChunkedStream,
  createMockResponse,
  createRoutedSession,
  noSleep,
};
