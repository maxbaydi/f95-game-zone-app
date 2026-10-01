// @ts-check

/**
 * Details written in the starter post of an F95 game thread, read from its
 * plain text (the same text the archive password is read from). Posts
 * follow one layout:
 *
 *   Overview:
 *   <one or more paragraphs>
 *   Thread Updated: 2026-10-01
 *   Release Date: 2026-09-30
 *   Developer: Name - Website - Patreon
 *   Censored: No
 *   Version: 0.6
 *   OS: Windows, Linux, Mac
 *   Language: English
 *   Genre: <spoiler> ...
 *   Installation: ... Changelog: ... Developer Notes: ... DOWNLOAD ...
 *
 * Labels are matched at the start of a line, with or without a colon and
 * bold markup; a value is on the label's line or on the next non-empty
 * line. The overview runs from its label to the next label.
 */

const OVERVIEW_MAX_LENGTH = 4000;
const VALUE_MAX_LENGTH = 300;

/** Label → field name. Order matters only for readability. */
const FIELD_LABELS = Object.freeze({
  overview: ["overview", "synopsis", "description", "about"],
  threadUpdated: ["thread updated", "thread update", "updated"],
  releaseDate: ["release date", "released"],
  developer: ["developer", "developer/publisher", "dev"],
  censored: ["censored", "censorship"],
  version: ["version"],
  os: ["os", "platform", "platforms"],
  language: ["language", "languages"],
});

/** Lines that end the overview without carrying a value we keep. */
const SECTION_LABELS = [
  "genre",
  "genres",
  "tags",
  "store",
  "other games",
  "installation",
  "install",
  "changelog",
  "change log",
  "changelogs",
  "developer notes",
  "dev notes",
  "notes",
  "download",
  "downloads",
  "links",
  "extras",
  "walkthrough",
  "patch",
  "patches",
  "mods",
  "support",
];

const SPOILER_LINES = /^(?:spoiler|спойлер)[:：]?$/i;
// Zero-width space/joiners and the BOM that forum markup leaves behind.
const INVISIBLE_CHARACTERS = new RegExp("\\u200b|\\u200c|\\u200d|\\ufeff", "g");

/**
 * @param {string} value
 */
function cleanLine(value) {
  return String(value || "")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/^[\s*_]+|[\s*_]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} line
 * @returns {{ field: string, value: string } | null}
 */
function matchLabel(line) {
  const cleaned = cleanLine(line);
  if (!cleaned || cleaned.length > 160) {
    return null;
  }
  const lower = cleaned.toLowerCase();
  for (const [field, labels] of Object.entries(FIELD_LABELS)) {
    for (const label of labels) {
      if (lower === label || lower === `${label}:` || lower === `${label}：`) {
        return { field, value: "" };
      }
      if (lower.startsWith(`${label}:`) || lower.startsWith(`${label}：`)) {
        return { field, value: cleaned.slice(label.length + 1).trim() };
      }
      // "Updated" alone must not swallow "Thread Updated"; a bare one-word
      // label needs a colon to count.
      if (label.includes(" ") && lower.startsWith(`${label} `) && /\d/.test(cleaned)) {
        return { field, value: cleaned.slice(label.length).trim() };
      }
    }
  }
  for (const label of SECTION_LABELS) {
    if (lower === label || lower === `${label}:` || lower.startsWith(`${label}:`)) {
      return { field: "section", value: "" };
    }
  }
  if (/^download(?:s)?\b/i.test(cleaned) && cleaned.length <= 40) {
    return { field: "section", value: "" };
  }
  return null;
}

/**
 * "Lounatick - Website - Patreon - Steam" → "Lounatick": the links of a
 * developer line render as plain words after a dash.
 * @param {string} value
 */
function cleanDeveloper(value) {
  const first = cleanLine(value).split(/\s+[-–—|]\s+/)[0] || "";
  return first.replace(/\s*\((?:website|patreon|steam|itch|discord|twitter|x)\)\s*$/i, "").trim();
}

/**
 * @param {string} value
 */
function cleanCensored(value) {
  const cleaned = cleanLine(value);
  if (!cleaned) {
    return "";
  }
  if (/^(no|none|uncensored|not censored|nope)\b/i.test(cleaned)) {
    return "No";
  }
  if (/^(yes|censored|mosaic|partial)/i.test(cleaned)) {
    return cleaned.length <= 40 ? cleaned : "Yes";
  }
  return cleaned.slice(0, VALUE_MAX_LENGTH);
}

/**
 * @typedef {{
 *   overview: string,
 *   threadUpdated: string,
 *   releaseDate: string,
 *   developer: string,
 *   censored: string,
 *   version: string,
 *   os: string,
 *   language: string,
 * }} ThreadDetails
 */

/**
 * @param {string | null | undefined} postText
 * @returns {ThreadDetails}
 */
function extractThreadDetails(postText) {
  /** @type {ThreadDetails} */
  const details = {
    overview: "",
    threadUpdated: "",
    releaseDate: "",
    developer: "",
    censored: "",
    version: "",
    os: "",
    language: "",
  };
  const lines = String(postText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(INVISIBLE_CHARACTERS, ""));
  if (lines.length === 0) {
    return details;
  }

  /** @type {string | null} */
  let current = null;
  /** @type {string[]} */
  const overviewLines = [];
  /** @type {Record<string, string>} */
  const values = {};
  let sawLabel = false;

  const finishOverview = () => {
    if (current === "overview") {
      current = null;
    }
  };

  for (const rawLine of lines) {
    const label = matchLabel(rawLine);
    if (label) {
      sawLabel = true;
      finishOverview();
      if (label.field === "section") {
        current = null;
        continue;
      }
      if (label.field === "overview") {
        current = "overview";
        if (label.value) {
          overviewLines.push(label.value);
        }
        continue;
      }
      if (label.value) {
        values[label.field] = values[label.field] || label.value;
        current = null;
      } else {
        current = label.field;
      }
      continue;
    }

    const text = rawLine.trim();
    if (current === "overview") {
      if (SPOILER_LINES.test(cleanLine(text))) {
        continue;
      }
      overviewLines.push(text);
      continue;
    }
    if (current && text) {
      if (!SPOILER_LINES.test(cleanLine(text))) {
        values[current] = values[current] || text;
        current = null;
      }
      continue;
    }
    if (!sawLabel && text && !current) {
      // Text before any label: some posts skip the "Overview:" line.
      overviewLines.push(text);
    }
  }

  const overview = overviewLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  details.overview = overview.length > OVERVIEW_MAX_LENGTH ? `${overview.slice(0, OVERVIEW_MAX_LENGTH - 1).trimEnd()}…` : overview;
  details.threadUpdated = cleanLine(values.threadUpdated || "").slice(0, VALUE_MAX_LENGTH);
  details.releaseDate = cleanLine(values.releaseDate || "").slice(0, VALUE_MAX_LENGTH);
  details.developer = cleanDeveloper(values.developer || "").slice(0, VALUE_MAX_LENGTH);
  details.censored = cleanCensored(values.censored || "");
  details.version = cleanLine(values.version || "").slice(0, VALUE_MAX_LENGTH);
  details.os = cleanLine(values.os || "").slice(0, VALUE_MAX_LENGTH);
  details.language = cleanLine(values.language || "").slice(0, VALUE_MAX_LENGTH);
  return details;
}

/**
 * @param {ThreadDetails | null | undefined} details
 */
function hasThreadDetails(details) {
  return Boolean(
    details &&
      (details.overview || details.language || details.os || details.censored || details.releaseDate || details.developer),
  );
}

module.exports = {
  OVERVIEW_MAX_LENGTH,
  extractThreadDetails,
  hasThreadDetails,
};
