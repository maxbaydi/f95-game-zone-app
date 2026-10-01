// @ts-check

/**
 * Parsing of the F95 "Latest Updates" data, the source of the app's own
 * metadata catalog (replaces the external Atlas feed).
 *
 * The page https://f95zone.to/sam/latest_alpha/ loads its rows from
 * latest_data.php?cmd=list&cat=games&page=N&rows=90&sort=date and answers
 *   { status: "ok", msg: { data: [row...], pagination: { page, total }, count } }
 * where a row is
 *   { thread_id, title, creator, version, views, likes, prefixes: [id...],
 *     tags: [id...], rating, cover, screens: [url...], date: "3 hrs",
 *     watched, ignored, new, ts }
 * Prefix and tag names are not in the rows: the page embeds them as
 * `var latestUpdates = {"prefixes":{"games":[{group...}]},"tags":{id:name}}`.
 * Both shapes are recorded in test/fixtures/f95/catalog.
 *
 * Everything here is pure: no network, no database.
 */

const F95_BASE_URL = "https://f95zone.to";
const LATEST_PAGE_URL = `${F95_BASE_URL}/sam/latest_alpha/`;
const LATEST_DATA_URL = `${F95_BASE_URL}/sam/latest_alpha/latest_data.php`;
const CATALOG_CATEGORY = "games";
const PAGE_ROWS = 90;

const PREFIX_GROUPS = Object.freeze({
  ENGINE: "Engine",
  STATUS: "Status",
  OTHER: "Other",
});

/** A game thread without a status prefix is still in development. */
const DEFAULT_STATUS = "Ongoing";

/**
 * Prefix ids of the games category as the site defined them on 2026-10-01
 * (test/fixtures/f95/catalog/latest_alpha.html). Used only when the page
 * cannot be read, so rows still get an engine and a status.
 */
const DEFAULT_DEFINITIONS = Object.freeze({
  prefixes: Object.freeze({
    1: { id: 1, name: "QSP", group: PREFIX_GROUPS.ENGINE },
    2: { id: 2, name: "RPGM", group: PREFIX_GROUPS.ENGINE },
    3: { id: 3, name: "Unity", group: PREFIX_GROUPS.ENGINE },
    4: { id: 4, name: "HTML", group: PREFIX_GROUPS.ENGINE },
    5: { id: 5, name: "RAGS", group: PREFIX_GROUPS.ENGINE },
    6: { id: 6, name: "Java", group: PREFIX_GROUPS.ENGINE },
    7: { id: 7, name: "Ren'Py", group: PREFIX_GROUPS.ENGINE },
    8: { id: 8, name: "Flash", group: PREFIX_GROUPS.ENGINE },
    12: { id: 12, name: "ADRIFT", group: PREFIX_GROUPS.ENGINE },
    13: { id: 13, name: "VN", group: PREFIX_GROUPS.OTHER },
    14: { id: 14, name: "Others", group: PREFIX_GROUPS.ENGINE },
    17: { id: 17, name: "Tads", group: PREFIX_GROUPS.ENGINE },
    18: { id: 18, name: "Completed", group: PREFIX_GROUPS.STATUS },
    19: { id: 19, name: "Collection", group: PREFIX_GROUPS.OTHER },
    20: { id: 20, name: "Onhold", group: PREFIX_GROUPS.STATUS },
    22: { id: 22, name: "Abandoned", group: PREFIX_GROUPS.STATUS },
    23: { id: 23, name: "SiteRip", group: PREFIX_GROUPS.OTHER },
    30: { id: 30, name: "Wolf RPG", group: PREFIX_GROUPS.ENGINE },
    31: { id: 31, name: "Unreal Engine", group: PREFIX_GROUPS.ENGINE },
    47: { id: 47, name: "WebGL", group: PREFIX_GROUPS.ENGINE },
    116: { id: 116, name: "Godot", group: PREFIX_GROUPS.ENGINE },
  }),
  tags: Object.freeze({}),
});

/**
 * @typedef {{ id: number, name: string, group: string }} PrefixDefinition
 * @typedef {{ prefixes: Record<string, PrefixDefinition>, tags: Record<string, string> }} CatalogDefinitions
 */

/**
 * @typedef {{
 *   f95Id: number,
 *   title: string,
 *   creator: string,
 *   version: string,
 *   engine: string,
 *   status: string,
 *   category: string,
 *   prefixIds: number[],
 *   prefixes: string[],
 *   tagIds: number[],
 *   tags: string[],
 *   coverUrl: string,
 *   screens: string[],
 *   rating: number,
 *   likes: number,
 *   views: number,
 *   updatedTs: number,
 *   siteUrl: string,
 * }} CatalogEntry
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanText(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toPositiveInteger(value) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toCount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toRating(value) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.min(5, Math.round(number * 100) / 100);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toHttpUrl(value) {
  const text = String(value ?? "").trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : "";
}

/**
 * The list links covers and screenshots on the preview host (scaled
 * copies); the thread links the same path on the attachments host at full
 * size. The path is identical, so the full-size file is one host swap away.
 * @param {unknown} value
 * @returns {string}
 */
function toFullSizeImageUrl(value) {
  const url = toHttpUrl(value);
  return url.replace(/^https?:\/\/preview\.f95zone\.to\//i, "https://attachments.f95zone.to/");
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function toIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = [];
  const seen = new Set();
  for (const entry of value) {
    const id = toPositiveInteger(entry);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Canonical thread URL. The site also accepts `/threads/<slug>.<id>/`; the
 * numeric form never changes when the title is edited.
 * @param {number} f95Id
 */
function buildThreadUrl(f95Id) {
  return `${F95_BASE_URL}/threads/${f95Id}/`;
}

/**
 * @param {{ page: number, rows?: number, sort?: string, category?: string, search?: string }} input
 */
function buildListUrl(input) {
  const params = new URLSearchParams();
  params.set("cmd", "list");
  params.set("cat", input.category || CATALOG_CATEGORY);
  params.set("page", String(Math.max(1, toPositiveInteger(input.page) || 1)));
  params.set("rows", String(toPositiveInteger(input.rows) || PAGE_ROWS));
  params.set("sort", input.sort || "date");
  if (input.search) {
    params.set("search", input.search);
  }
  return `${LATEST_DATA_URL}?${params.toString()}`;
}

/**
 * Prefix and tag names embedded in the Latest Updates page.
 * @typedef {{ ok: boolean, definitions: CatalogDefinitions | null, error: string }} DefinitionsParseResult
 */

/**
 * @param {string} html
 * @param {{ category?: string }=} options
 * @returns {DefinitionsParseResult}
 */
function parseDefinitions(html, options = {}) {
  /** @param {string} error */
  const failure = (error) => ({ ok: false, definitions: null, error });
  const text = String(html || "");
  const marker = /var\s+latestUpdates\s*=\s*/.exec(text);
  if (!marker) {
    return failure("The Latest Updates page has no definitions block.");
  }
  const start = marker.index + marker[0].length;
  if (text[start] !== "{") {
    return failure("The definitions block is not an object.");
  }
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) {
    return failure("The definitions block is not closed.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end));
  } catch (error) {
    return failure(`The definitions block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const category = options.category || CATALOG_CATEGORY;
  const groups = Array.isArray(parsed?.prefixes?.[category]) ? parsed.prefixes[category] : [];
  /** @type {Record<string, PrefixDefinition>} */
  const prefixes = {};
  for (const group of groups) {
    const groupName = cleanText(group?.name);
    for (const prefix of Array.isArray(group?.prefixes) ? group.prefixes : []) {
      const id = toPositiveInteger(prefix?.id);
      const name = cleanText(prefix?.name);
      if (id && name) {
        prefixes[String(id)] = { id, name, group: groupName };
      }
    }
  }
  /** @type {Record<string, string>} */
  const tags = {};
  for (const [id, name] of Object.entries(parsed?.tags && typeof parsed.tags === "object" ? parsed.tags : {})) {
    const tagId = toPositiveInteger(id);
    const tagName = cleanText(name);
    if (tagId && tagName) {
      tags[String(tagId)] = tagName;
    }
  }
  if (Object.keys(prefixes).length === 0) {
    return failure(`The definitions block has no prefixes for "${category}".`);
  }
  return { ok: true, definitions: { prefixes, tags }, error: "" };
}

/**
 * @param {CatalogDefinitions | null | undefined} definitions
 * @returns {CatalogDefinitions}
 */
function resolveDefinitions(definitions) {
  const prefixes = definitions?.prefixes && typeof definitions.prefixes === "object" ? definitions.prefixes : {};
  const tags = definitions?.tags && typeof definitions.tags === "object" ? definitions.tags : {};
  return {
    prefixes: { ...DEFAULT_DEFINITIONS.prefixes, ...prefixes },
    tags: { ...DEFAULT_DEFINITIONS.tags, ...tags },
  };
}

/**
 * One list row as the catalog stores it, or null when the row cannot be a
 * game (no numeric thread id, no title).
 * @param {any} row
 * @param {CatalogDefinitions | null | undefined} definitions
 * @param {{ category?: string }=} options
 * @returns {CatalogEntry | null}
 */
function normalizeCatalogEntry(row, definitions, options = {}) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const f95Id = toPositiveInteger(row.thread_id);
  const title = cleanText(row.title);
  if (!f95Id || !title) {
    return null;
  }
  const resolved = resolveDefinitions(definitions);
  const prefixIds = toIdList(row.prefixes);
  const prefixNames = [];
  let engine = "";
  let status = "";
  for (const id of prefixIds) {
    const definition = resolved.prefixes[String(id)];
    if (!definition) {
      continue;
    }
    prefixNames.push(definition.name);
    if (definition.group === PREFIX_GROUPS.ENGINE && !engine) {
      engine = definition.name;
    } else if (definition.group === PREFIX_GROUPS.STATUS && !status) {
      status = definition.name;
    }
  }
  const tagIds = toIdList(row.tags);
  const tags = tagIds.map((id) => resolved.tags[String(id)]).filter(Boolean);
  const screens = Array.isArray(row.screens) ? row.screens.map(toFullSizeImageUrl).filter(Boolean) : [];

  return {
    f95Id,
    title,
    creator: cleanText(row.creator),
    version: cleanText(row.version),
    engine,
    status: status || DEFAULT_STATUS,
    category: options.category || CATALOG_CATEGORY,
    prefixIds,
    prefixes: prefixNames,
    tagIds,
    tags,
    coverUrl: toFullSizeImageUrl(row.cover),
    screens,
    rating: toRating(row.rating),
    likes: toCount(row.likes),
    views: toCount(row.views),
    updatedTs: toPositiveInteger(row.ts),
    siteUrl: buildThreadUrl(f95Id),
  };
}

/**
 * @typedef {{
 *   ok: boolean,
 *   entries: CatalogEntry[],
 *   invalid: number,
 *   page: number,
 *   totalPages: number,
 *   count: number,
 *   error: string,
 *   code: "" | "not-json" | "site-error" | "bad-shape",
 * }} ListParseResult
 */

/**
 * @param {"not-json" | "site-error" | "bad-shape"} code
 * @param {string} error
 * @returns {ListParseResult}
 */
function listFailure(code, error) {
  return { ok: false, entries: [], invalid: 0, page: 0, totalPages: 0, count: 0, error, code };
}

/**
 * @param {string | object} payload the response body (text or already parsed)
 * @param {CatalogDefinitions | null | undefined} definitions
 * @param {{ category?: string }=} options
 * @returns {ListParseResult}
 */
function parseListResponse(payload, definitions, options = {}) {
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      const looksLikeLogin = /<form[^>]+login|name="login"|Log in/i.test(payload) && /<html/i.test(payload);
      return listFailure(
        "not-json",
        looksLikeLogin
          ? "F95 answered with the login page: the session has expired."
          : "F95 did not answer with JSON.",
      );
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return listFailure("bad-shape", "F95 answered with an empty document.");
  }
  if (parsed.status !== "ok") {
    const message = typeof parsed.msg === "string" ? parsed.msg : "unknown error";
    return listFailure("site-error", `F95 rejected the request: ${message}`);
  }
  const container = parsed.msg && typeof parsed.msg === "object" ? parsed.msg : null;
  if (!container || !Array.isArray(container.data)) {
    return listFailure("bad-shape", "F95 answered without a data list.");
  }
  const entries = [];
  let invalid = 0;
  for (const row of container.data) {
    const entry = normalizeCatalogEntry(row, definitions, options);
    if (entry) {
      entries.push(entry);
    } else {
      invalid += 1;
    }
  }
  return {
    ok: true,
    entries,
    invalid,
    page: toPositiveInteger(container.pagination?.page),
    totalPages: toPositiveInteger(container.pagination?.total),
    count: toCount(container.count),
    error: "",
    code: "",
  };
}

module.exports = {
  CATALOG_CATEGORY,
  DEFAULT_DEFINITIONS,
  DEFAULT_STATUS,
  F95_BASE_URL,
  LATEST_DATA_URL,
  LATEST_PAGE_URL,
  PAGE_ROWS,
  PREFIX_GROUPS,
  buildListUrl,
  buildThreadUrl,
  decodeHtmlEntities,
  normalizeCatalogEntry,
  parseDefinitions,
  parseListResponse,
  resolveDefinitions,
  toFullSizeImageUrl,
};
