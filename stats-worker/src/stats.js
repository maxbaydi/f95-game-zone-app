import { renderDashboard } from "./dashboard.js";

// Per-day rows older than this are deleted by the daily cron. The installs
// table keeps one row per install for the all-time count.
export const RETENTION_DAYS = 400;
export const DEFAULT_STATS_DAYS = 30;
export const MAX_STATS_DAYS = 366;
const MAX_PING_BYTES = 2048;
const BREAKDOWN_LIMIT = 20;

const INSTALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.-]{1,32})?$/;
const PLATFORMS = new Set(["win32", "linux", "darwin"]);
const ARCHES = new Set(["x64", "arm64", "ia32"]);
const COUNTRY_PATTERN = /^[A-Z][A-Z0-9]$/;

/**
 * @param {number} timestamp
 */
export function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * @param {string} day YYYY-MM-DD
 * @param {number} delta days to add (negative goes back)
 */
export function shiftDay(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return utcDay(date.getTime());
}

/**
 * Validates a ping body. Only the four known fields are read; anything else
 * in the body is ignored and never stored.
 *
 * @param {string} text
 */
export function parsePing(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "Body is not JSON." };
  }
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const id = String(body.id ?? "");
  const version = String(body.version ?? "");
  const platform = String(body.platform ?? "");
  const arch = String(body.arch ?? "");
  if (!INSTALL_ID_PATTERN.test(id)) {
    return { ok: false, error: "Invalid id." };
  }
  if (!VERSION_PATTERN.test(version)) {
    return { ok: false, error: "Invalid version." };
  }
  if (!PLATFORMS.has(platform)) {
    return { ok: false, error: "Invalid platform." };
  }
  if (!ARCHES.has(arch)) {
    return { ok: false, error: "Invalid arch." };
  }
  return { ok: true, value: { id, version, platform, arch } };
}

/**
 * @param {unknown} value Cloudflare's request.cf.country ("XX" when unknown)
 */
export function normalizeCountry(value) {
  const country = String(value ?? "").toUpperCase();
  return COUNTRY_PATTERN.test(country) && country !== "XX" ? country : "";
}

/**
 * @param {any} db D1 binding
 * @param {{ id: string, version: string, platform: string, arch: string }} ping
 * @param {string} day
 * @param {string} country
 */
export async function recordPing(db, ping, day, country) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO installs (id, first_seen, last_seen, first_version, version, platform, arch, country)
         VALUES (?1, ?2, ?2, ?3, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET
           last_seen = excluded.last_seen,
           version = excluded.version,
           platform = excluded.platform,
           arch = excluded.arch,
           country = CASE WHEN excluded.country = '' THEN installs.country ELSE excluded.country END`,
      )
      .bind(ping.id, day, ping.version, ping.platform, ping.arch, country),
    db
      .prepare(
        `INSERT INTO daily_active (day, id, version, platform)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (day, id) DO UPDATE SET version = excluded.version`,
      )
      .bind(day, ping.id, ping.version, ping.platform),
  ]);
}

/**
 * @param {any} db
 * @param {string} sql
 * @param {unknown[]} params
 */
async function selectAll(db, sql, params) {
  const result = await db.prepare(sql).bind(...params).all();
  return Array.isArray(result?.results) ? result.results : [];
}

/**
 * @param {any} db
 * @param {string} today
 * @param {number} days length of the daily series, today included
 */
export async function buildStats(db, today, days) {
  const from = shiftDay(today, -(days - 1));
  const weekFrom = shiftDay(today, -6);
  const monthFrom = shiftDay(today, -29);

  const [totalsRow] = await selectAll(
    db,
    `SELECT
       (SELECT COUNT(*) FROM installs) AS installs,
       (SELECT COUNT(*) FROM daily_active WHERE day = ?1) AS active1d,
       (SELECT COUNT(DISTINCT id) FROM daily_active WHERE day >= ?2) AS active7d,
       (SELECT COUNT(DISTINCT id) FROM daily_active WHERE day >= ?3) AS active30d,
       (SELECT COUNT(*) FROM installs WHERE first_seen >= ?3) AS new30d`,
    [today, weekFrom, monthFrom],
  );
  const activeRows = await selectAll(
    db,
    `SELECT day, COUNT(*) AS count FROM daily_active WHERE day >= ?1 GROUP BY day`,
    [from],
  );
  const newRows = await selectAll(
    db,
    `SELECT first_seen AS day, COUNT(*) AS count FROM installs WHERE first_seen >= ?1 GROUP BY first_seen`,
    [from],
  );

  // Breakdowns describe the installs used in the last 30 days.
  const breakdown = (expression) =>
    selectAll(
      db,
      `SELECT ${expression} AS name, COUNT(*) AS users
       FROM installs WHERE last_seen >= ?1
       GROUP BY name ORDER BY users DESC, name ASC LIMIT ${BREAKDOWN_LIMIT}`,
      [monthFrom],
    );
  const versions = await breakdown("version");
  const platforms = await breakdown("platform || ' ' || arch");
  const countries = await breakdown("CASE WHEN country = '' THEN '??' ELSE country END");

  const activeByDay = new Map(activeRows.map((row) => [row.day, Number(row.count)]));
  const newByDay = new Map(newRows.map((row) => [row.day, Number(row.count)]));
  const daily = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    daily.push({
      day,
      active: activeByDay.get(day) || 0,
      new: newByDay.get(day) || 0,
    });
  }

  const toList = (rows) =>
    rows.map((row) => ({ name: String(row.name), users: Number(row.users) }));

  return {
    today,
    days,
    totals: {
      installs: Number(totalsRow?.installs) || 0,
      active1d: Number(totalsRow?.active1d) || 0,
      active7d: Number(totalsRow?.active7d) || 0,
      active30d: Number(totalsRow?.active30d) || 0,
      new30d: Number(totalsRow?.new30d) || 0,
    },
    daily,
    versions: toList(versions),
    platforms: toList(platforms),
    countries: toList(countries),
  };
}

/**
 * @param {any} db
 * @param {string} today
 */
export async function pruneOldDays(db, today) {
  await db
    .prepare(`DELETE FROM daily_active WHERE day < ?1`)
    .bind(shiftDay(today, -RETENTION_DAYS))
    .run();
}

/**
 * Compares without an early exit so response time does not leak how much of
 * the token matched.
 *
 * @param {string} left
 * @param {string} right
 */
function safeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

/**
 * @param {unknown} data
 * @param {number} status
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * @param {Request} request
 * @param {{ DB: any, STATS_TOKEN?: string, GITHUB_REPO?: string }} env
 * @param {number} now
 */
export async function handleRequest(request, env, now = Date.now()) {
  const url = new URL(request.url);

  if (url.pathname === "/v1/ping") {
    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_PING_BYTES) {
      return json({ error: "Body too large." }, 413);
    }
    const text = await request.text();
    if (text.length > MAX_PING_BYTES) {
      return json({ error: "Body too large." }, 413);
    }
    const parsed = parsePing(text);
    if (!parsed.ok) {
      return json({ error: parsed.error }, 400);
    }
    // @ts-ignore request.cf exists only on Cloudflare
    const country = normalizeCountry(request.cf?.country);
    await recordPing(env.DB, parsed.value, utcDay(now), country);
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/v1/stats") {
    if (request.method !== "GET") {
      return json({ error: "Use GET." }, 405);
    }
    if (!env.STATS_TOKEN) {
      return json({ error: "STATS_TOKEN is not configured." }, 503);
    }
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || !safeEqual(token, env.STATS_TOKEN)) {
      return json({ error: "Wrong or missing token." }, 401);
    }
    const requestedDays = Number.parseInt(url.searchParams.get("days") || "", 10);
    const days = Number.isFinite(requestedDays)
      ? Math.min(MAX_STATS_DAYS, Math.max(1, requestedDays))
      : DEFAULT_STATS_DAYS;
    const stats = await buildStats(env.DB, utcDay(now), days);
    return json({ generatedAt: new Date(now).toISOString(), ...stats });
  }

  if (url.pathname === "/" && request.method === "GET") {
    return new Response(renderDashboard({ repo: env.GITHUB_REPO || "" }), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  }

  return json({ error: "Not found." }, 404);
}
