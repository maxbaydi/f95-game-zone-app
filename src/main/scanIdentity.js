// @ts-check

const fs = require("fs");
const path = require("path");

const { parseScanTitle } = require("../shared/scanTitleParser");
const {
  buildCompactScanKey,
  extractSignificantTokens,
  normalizeVersionLabel,
} = require("../shared/scanMatchUtils");

const GENERIC_EXECUTABLE_KEYS = new Set([
  "app",
  "application",
  "game",
  "index",
  "launcher",
  "launch",
  "play",
  "run",
  "start",
  "update",
  "updater",
]);

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function safeReadTextFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > 256 * 1024) {
      return "";
    }

    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeAuxiliarySegment(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }

  if (normalizeVersionLabel(normalized)) {
    return true;
  }

  const compactKey = buildCompactScanKey(normalized);
  return (
    compactKey === "win" ||
    compactKey === "windows" ||
    compactKey === "linux" ||
    compactKey === "mac" ||
    compactKey === "android" ||
    compactKey === "pc" ||
    compactKey === "build" ||
    compactKey === "public"
  );
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isUsefulCreatorHint(value) {
  const compactKey = buildCompactScanKey(value);
  if (!compactKey || compactKey.length < 3) {
    return false;
  }

  return !looksLikeAuxiliarySegment(value);
}

/**
 * @param {string} rawValue
 * @returns {{ title: string, creator: string } | null}
 */
function extractDelimitedTitleCreator(rawValue) {
  const trimmed = String(rawValue || "").trim();
  const match = trimmed.match(/^(.+?)\s+(?:by|from)\s+(.+)$/i);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const title = String(match[1]).trim();
  const creator = String(match[2]).trim();
  if (!title || !isUsefulCreatorHint(creator)) {
    return null;
  }

  return { title, creator };
}

/**
 * @param {string} rawValue
 * @returns {{ title: string, creator: string } | null}
 */
function extractAttachedCreatorSuffix(rawValue) {
  const normalized = String(rawValue || "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  const creatorTailWords = new Set([
    "dev",
    "devs",
    "game",
    "games",
    "lab",
    "labs",
    "productions",
    "production",
    "studio",
    "studios",
    "team",
    "works",
  ]);
  const tokens = normalized.split(" ").filter(Boolean);

  for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
    const token = tokens[tokenIndex];
    if (!/[a-z][A-Z]/.test(token)) {
      continue;
    }

    const splitToken = token.replace(/([a-z])([A-Z])/g, "$1 $2");
    const parts = splitToken.split(" ").filter(Boolean);
    for (let splitIndex = 1; splitIndex < parts.length; splitIndex += 1) {
      const creatorParts = parts.slice(splitIndex);
      const creatorTail = creatorParts[creatorParts.length - 1]?.toLowerCase() || "";
      if (!creatorTailWords.has(creatorTail)) {
        continue;
      }

      const titleParts = [...tokens.slice(0, tokenIndex), ...parts.slice(0, splitIndex)];
      const title = titleParts.join(" ").trim();
      const creator = creatorParts.join(" ").trim();

      if (
        extractSignificantTokens(title).length === 0 ||
        !isUsefulCreatorHint(creator)
      ) {
        continue;
      }

      return {
        title,
        creator,
      };
    }
  }

  return null;
}

/**
 * @param {string} rawValue
 * @param {string} source
 * @param {number} weight
 * @param {string[]} reasons
 * @returns {{ title: string, version: string, source: string, weight: number, reasons: string[] } | null}
 */
function createTitleHint(rawValue, source, weight, reasons) {
  const parsed = parseScanTitle(rawValue);
  const compactKey = buildCompactScanKey(parsed.title);
  const tokenCount = extractSignificantTokens(parsed.title).length;

  if (!compactKey || compactKey.length < 3 || tokenCount === 0) {
    return null;
  }

  return {
    title: parsed.title,
    version: parsed.version,
    source,
    weight,
    reasons,
  };
}

/**
 * @param {string} rawValue
 * @param {string} source
 * @param {number} weight
 * @param {string[]} hintReasons
 * @param {Array<{ title: string, version: string, source: string, weight: number, reasons: string[] }>} titleHints
 * @param {string[]} creatorHints
 * @param {string[]} reasons
 */
function appendTitleHints(
  rawValue,
  source,
  weight,
  hintReasons,
  titleHints,
  creatorHints,
  reasons,
) {
  titleHints.push(createTitleHint(rawValue, source, weight, hintReasons));

  const delimited = extractDelimitedTitleCreator(rawValue);
  if (delimited) {
    titleHints.push(
      createTitleHint(delimited.title, source, weight + 8, [
        ...hintReasons,
        "split creator suffix from title metadata",
      ]),
    );
    creatorHints.push(delimited.creator);
    reasons.push("parsed creator from title suffix");
  }

  const attached = extractAttachedCreatorSuffix(rawValue);
  if (attached) {
    titleHints.push(
      createTitleHint(attached.title, source, weight + 6, [
        ...hintReasons,
        "split attached studio suffix from title metadata",
      ]),
    );
    creatorHints.push(attached.creator);
    reasons.push("parsed creator from attached studio suffix");
  }
}

/**
 * @param {Array<{ title: string, version: string, source: string, weight: number, reasons: string[] }>} hints
 */
function dedupeTitleHints(hints) {
  const bestByKey = new Map();

  for (const hint of hints) {
    if (!hint) {
      continue;
    }

    const key = buildCompactScanKey(hint.title);
    if (!key) {
      continue;
    }

    const currentBest = bestByKey.get(key);
    if (!currentBest || hint.weight > currentBest.weight) {
      bestByKey.set(key, hint);
    }
  }

  const deduped = [...bestByKey.values()];

  deduped.sort((left, right) => {
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }

    return right.title.length - left.title.length;
  });

  return deduped;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function dedupeValues(values) {
  const seen = new Set();
  const deduped = [];

  for (const value of values) {
    const trimmed = String(value || "").trim();
    const key = buildCompactScanKey(trimmed);
    if (!trimmed || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(trimmed);
  }

  return deduped;
}

/**
 * @param {string} rootPath
 * @returns {{ title: string, version: string, reasons: string[] } | null}
 */
function readRenpyOptionsHints(rootPath) {
  const candidatePaths = [path.join(rootPath, "game", "options.rpy")];

  for (const candidatePath of candidatePaths) {
    if (!fileExists(candidatePath)) {
      continue;
    }

    const content = safeReadTextFile(candidatePath);
    if (!content) {
      continue;
    }

    const titlePatterns = [
      /config\.name\s*=\s*_\(\s*["']([^"']+)["']\s*\)/i,
      /config\.name\s*=\s*["']([^"']+)["']/i,
      /build\.name\s*=\s*["']([^"']+)["']/i,
    ];
    const versionPatterns = [
      /config\.version\s*=\s*["']([^"']+)["']/i,
      /build\.version\s*=\s*["']([^"']+)["']/i,
    ];

    let title = "";
    let version = "";

    for (const pattern of titlePatterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        title = String(match[1]).trim();
        break;
      }
    }

    for (const pattern of versionPatterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        version = String(match[1]).trim();
        break;
      }
    }

    if (title || version) {
      return {
        title,
        version,
        reasons: [
          title ? "read title from Ren'Py options.rpy" : "",
          version ? "read version from Ren'Py options.rpy" : "",
        ].filter(Boolean),
      };
    }
  }

  return null;
}

/**
 * @param {{
 *   targetPath: string,
 *   rootPath: string,
 *   relativePath: string,
 *   isFile: boolean,
 *   format?: string,
 *   executables?: string[],
 *   engine?: string
 * }} input
 */
function extractScanCandidateIdentity(input) {
  const folderPath = input.isFile ? path.dirname(input.targetPath) : input.targetPath;
  const relativeFolderPath =
    input.relativePath ||
    path.relative(input.rootPath, folderPath) ||
    path.basename(folderPath);
  const relativeParts = relativeFolderPath
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const leafName = path.basename(folderPath);
  const titleHints = [];
  const creatorHints = [];
  const versionHints = [];
  const reasons = [];

  const executableNames = Array.isArray(input.executables) ? input.executables : [];
  const executableBaseNames = executableNames
    .map((executable) => path.basename(executable, path.extname(executable)))
    .filter((baseName) => {
      const compactKey = buildCompactScanKey(baseName);
      return compactKey && !GENERIC_EXECUTABLE_KEYS.has(compactKey);
    });

  const structuredMapping = {};
  if (input.format && input.format.trim()) {
    const formatParts = input.format
      .split("/")
      .map((part) => part.replace(/[{}]/g, "").trim())
      .filter(Boolean);

    if (relativeParts.length >= formatParts.length) {
      formatParts.forEach((part, index) => {
        structuredMapping[part] = relativeParts[index] || "";
      });

      if (structuredMapping.title) {
        appendTitleHints(
          structuredMapping.title,
          "structured-format",
          90,
          ["title extracted from configured scan format"],
          titleHints,
          creatorHints,
          reasons,
        );
      }

      if (structuredMapping.creator && isUsefulCreatorHint(structuredMapping.creator)) {
        creatorHints.push(structuredMapping.creator);
        reasons.push("creator extracted from configured scan format");
      }

      if (structuredMapping.version && normalizeVersionLabel(structuredMapping.version)) {
        versionHints.push(structuredMapping.version);
        reasons.push("version extracted from configured scan format");
      }
    }
  }

  appendTitleHints(
    leafName,
    "folder-name",
    60,
    ["parsed title from folder name"],
    titleHints,
    creatorHints,
    reasons,
  );

  for (const executableBaseName of executableBaseNames) {
    appendTitleHints(
      executableBaseName,
      "executable-name",
      76,
      [
        "parsed title from executable name",
      ],
      titleHints,
      creatorHints,
      reasons,
    );
  }

  const leafLooksAuxiliary = looksLikeAuxiliarySegment(leafName);
  if (leafLooksAuxiliary && relativeParts.length >= 2) {
    appendTitleHints(
      relativeParts[relativeParts.length - 2],
      "parent-folder",
      68,
      [
        "parsed title from parent folder because leaf folder looks like a build/version label",
      ],
      titleHints,
      creatorHints,
      reasons,
    );
  }

  if (!structuredMapping.creator) {
    if (relativeParts.length === 2 && isUsefulCreatorHint(relativeParts[0])) {
      creatorHints.push(relativeParts[0]);
      reasons.push("inferred creator from folder hierarchy");
    } else if (leafLooksAuxiliary && relativeParts.length >= 3) {
      const creatorCandidate = relativeParts[relativeParts.length - 3];
      if (isUsefulCreatorHint(creatorCandidate)) {
        creatorHints.push(creatorCandidate);
        reasons.push("inferred creator from grandparent folder");
      }
    }
  }

  const renpyHints =
    String(input.engine || "").toLowerCase() === "renpy" || fileExists(path.join(folderPath, "game"))
      ? readRenpyOptionsHints(folderPath)
      : null;

  if (renpyHints?.title) {
    appendTitleHints(
      renpyHints.title,
      "renpy-options",
      110,
      renpyHints.reasons,
      titleHints,
      creatorHints,
      reasons,
    );
  }

  if (renpyHints?.version && normalizeVersionLabel(renpyHints.version)) {
    versionHints.push(renpyHints.version);
  }

  const dedupedTitleHints = dedupeTitleHints(titleHints);
  const primaryTitleHint = dedupedTitleHints[0] || null;

  for (const hint of dedupedTitleHints.slice(0, 3)) {
    reasons.push(...hint.reasons);
    if (normalizeVersionLabel(hint.version)) {
      versionHints.push(hint.version);
    }
  }

  const dedupedCreators = dedupeValues(creatorHints);
  const dedupedVersions = dedupeValues(versionHints);

  return {
    title: primaryTitleHint?.title || parseScanTitle(leafName).title || leafName,
    creator: dedupedCreators[0] || "Unknown",
    version: dedupedVersions[0] || "Unknown",
    titleVariants: dedupedTitleHints.map((hint) => ({
      value: hint.title,
      source: hint.source,
      weight: hint.weight,
    })),
    creatorHints: dedupedCreators,
    versionHints: dedupedVersions,
    executableBaseNames: dedupeValues(executableBaseNames),
    reasons: dedupeValues(reasons),
  };
}

module.exports = {
  extractScanCandidateIdentity,
  readRenpyOptionsHints,
};
