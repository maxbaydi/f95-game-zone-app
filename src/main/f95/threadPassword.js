// @ts-check

/**
 * Archive passwords published in the starter post of an F95 thread, so an
 * encrypted download can be unpacked without asking the user to hunt for it.
 * The post is read as plain text; typical spellings are
 * "Password: xxx", "PW - xxx", "Archive password: xxx", "пароль: xxx",
 * on one line or on the next line after the label.
 */

const LABEL_PATTERN =
  /(?:^|\n)[^\S\n]*(?:\*\*|__)?(?:(?:archive|zip|rar|7z|unzip|unpack|extract(?:ion)?|file)\s+)?(?:password|passwd|pass|pw|pwd|пароль\s+(?:от\s+)?архива|пароль)(?:\*\*|__)?[^\S\n]*(?::|=|-|–|—|is|:\s*is)?[^\S\n]*(?:`|"|'|«|“)?([^\s`"'»”\n]{2,80})?(?:`|"|'|»|”)?[^\S\n]*(?:\n[^\S\n]*(?:`|"|'|«|“)?([^\s`"'»”\n]{2,80})(?:`|"|'|»|”)?)?/gi;

const REJECTED_VALUES = new Set([
  "protected",
  "required",
  "needed",
  "none",
  "no",
  "yes",
  "n/a",
  "na",
  "the",
  "is",
  "in",
  "on",
  "for",
  "see",
  "same",
  "below",
  "above",
  "here",
  "thread",
  "post",
  "link",
  "links",
  "download",
  "downloads",
  "file",
  "files",
  "archive",
  "нет",
  "есть",
  "смотри",
  "ниже",
]);

/**
 * @param {string} value
 */
function isPlausiblePassword(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    return false;
  }
  if (REJECTED_VALUES.has(trimmed.toLowerCase())) {
    return false;
  }
  if (/^https?:\/\//i.test(trimmed) || /\.(?:zip|rar|7z|exe|apk)$/i.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * @param {string | null | undefined} postText
 * @returns {string} the first plausible password, or ""
 */
function extractArchivePassword(postText) {
  const text = String(postText || "").replace(/\r\n?/g, "\n");
  if (!text || !/(?:password|passwd|pass\b|\bpw\b|pwd|пароль)/i.test(text)) {
    return "";
  }

  LABEL_PATTERN.lastIndex = 0;
  let match;
  while ((match = LABEL_PATTERN.exec(text)) !== null) {
    const sameLine = match[1] || "";
    const nextLine = match[2] || "";
    // "Password: protected" or "password is" on its own line: the real value
    // is often on the next line.
    if (isPlausiblePassword(sameLine)) {
      return sameLine;
    }
    if (isPlausiblePassword(nextLine)) {
      return nextLine;
    }
  }
  return "";
}

module.exports = {
  extractArchivePassword,
  isPlausiblePassword,
};
