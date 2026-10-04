// @ts-check

const crypto = require("crypto");
const fs = require("fs");
const { writeFileAtomicSync } = require("./atomicFile");

// Anonymous usage counter: once a UTC day the app tells the stats endpoint
// that this install is alive. The payload is a random install id created on
// this PC, the app version, the OS and the CPU architecture; nothing about
// games, the library or accounts. See docs/usage-stats.md.

const USAGE_STATS_FILE_NAME = "usage-stats.json";
const USAGE_STATS_ENV_VAR = "F95LAUNCHER_USAGE_STATS_URL";
const USAGE_STATS_REQUEST_TIMEOUT_MS = 10 * 1000;
const INSTALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {number} timestamp
 */
function toUtcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Accepts https URLs, plus plain http on localhost for testing a local
 * `wrangler dev`. Anything else turns reporting off.
 *
 * @param {unknown} value
 */
function normalizeUsageStatsEndpoint(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !isLocalHttp) {
      return "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * The environment variable wins (so a dev run can point at `wrangler dev`);
 * otherwise only packaged builds report, to the endpoint from package.json.
 *
 * @param {{
 *   isPackaged: boolean,
 *   env?: Record<string, string | undefined>,
 *   packageEndpoint?: unknown,
 * }} input
 */
function resolveUsageStatsEndpoint(input) {
  const fromEnv = normalizeUsageStatsEndpoint(input.env?.[USAGE_STATS_ENV_VAR]);
  if (fromEnv) {
    return fromEnv;
  }
  return input.isPackaged ? normalizeUsageStatsEndpoint(input.packageEndpoint) : "";
}

/**
 * @param {{
 *   statePath: string,
 *   endpoint: string,
 *   appVersion: string,
 *   platform?: string,
 *   arch?: string,
 *   isEnabled: () => boolean,
 *   fetchImpl?: (url: string, init: any) => Promise<{ ok: boolean, status: number }>,
 *   now?: () => number,
 *   randomUUID?: () => string,
 *   fs?: typeof fs,
 *   timeoutMs?: number,
 * }} options
 */
function createUsageStatsReporter(options) {
  const endpoint = normalizeUsageStatsEndpoint(options.endpoint);
  const fsImpl = options.fs || fs;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const randomUUID =
    typeof options.randomUUID === "function"
      ? options.randomUUID
      : () => crypto.randomUUID();
  const fetchImpl =
    typeof options.fetchImpl === "function"
      ? options.fetchImpl
      : (/** @type {string} */ url, /** @type {any} */ init) => fetch(url, init);
  const timeoutMs = Number(options.timeoutMs) || USAGE_STATS_REQUEST_TIMEOUT_MS;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;

  const isEnabled = () => {
    try {
      return options.isEnabled() !== false;
    } catch {
      return false;
    }
  };

  function readState() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(options.statePath, "utf8"));
      return {
        installId: INSTALL_ID_PATTERN.test(String(parsed?.installId))
          ? String(parsed.installId)
          : "",
        lastReportDay: DAY_PATTERN.test(String(parsed?.lastReportDay))
          ? String(parsed.lastReportDay)
          : "",
      };
    } catch {
      return { installId: "", lastReportDay: "" };
    }
  }

  /**
   * @param {{ installId: string, lastReportDay: string }} state
   */
  function writeState(state) {
    writeFileAtomicSync(options.statePath, `${JSON.stringify(state, null, 2)}\n`, {
      fs: fsImpl,
    });
  }

  /**
   * Sends today's ping unless it was already sent, reporting is off or the
   * build has no endpoint. A failed request leaves the day unmarked so the
   * next run retries.
   */
  async function reportIfDue() {
    if (!endpoint) {
      return { sent: false, reason: "no-endpoint" };
    }
    if (!isEnabled()) {
      return { sent: false, reason: "disabled" };
    }

    const today = toUtcDay(now());
    const state = readState();
    if (state.lastReportDay === today) {
      return { sent: false, reason: "already-sent" };
    }

    const installId = state.installId || randomUUID();
    if (!state.installId) {
      // Kept before the request so a crash mid-way never mints a second id.
      writeState({ installId, lastReportDay: state.lastReportDay });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}/v1/ping`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: installId,
          version: String(options.appVersion || "").replace(/^v/i, ""),
          platform,
          arch,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Usage stats endpoint answered HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }

    writeState({ installId, lastReportDay: today });
    return { sent: true, reason: "sent", day: today };
  }

  return {
    endpoint,
    /** Whether a run could send anything right now (endpoint set and switch on). */
    isActive: () => Boolean(endpoint) && isEnabled(),
    readState,
    reportIfDue,
  };
}

module.exports = {
  INSTALL_ID_PATTERN,
  USAGE_STATS_ENV_VAR,
  USAGE_STATS_FILE_NAME,
  createUsageStatsReporter,
  normalizeUsageStatsEndpoint,
  resolveUsageStatsEndpoint,
  toUtcDay,
};
