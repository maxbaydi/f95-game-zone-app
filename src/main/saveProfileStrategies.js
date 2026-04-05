// @ts-check

const fs = require("fs");
const path = require("path");

function normalizeIdentityToken(value, fallback = "unknown") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function normalizeRelativeSegments(value, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  const rawValue = String(value || "").replace(/\\/g, "/").trim();

  if (!rawValue) {
    return allowEmpty ? [] : [];
  }

  const rawSegments = rawValue
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (
    rawSegments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        segment.includes("\0"),
    )
  ) {
    return [];
  }

  return rawSegments;
}

function sanitizeFilePatterns(filePatterns) {
  const seenPatterns = new Set();
  const normalizedPatterns = [];

  for (const filePattern of Array.isArray(filePatterns) ? filePatterns : []) {
    const normalizedPattern = String(filePattern || "").trim();
    if (!normalizedPattern || seenPatterns.has(normalizedPattern)) {
      continue;
    }

    seenPatterns.add(normalizedPattern);
    normalizedPatterns.push(normalizedPattern);
  }

  return normalizedPatterns;
}

function wildcardPatternToRegExp(pattern) {
  const escapedPattern = String(pattern || "")
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escapedPattern}$`, "i");
}

function matchFilePatterns(entryName, filePatterns) {
  const patterns = sanitizeFilePatterns(filePatterns);
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((filePattern) =>
    wildcardPatternToRegExp(filePattern).test(entryName),
  );
}

function pathExistsSync(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getKnownFolderRoot(baseFolder) {
  const userProfile =
    process.env.USERPROFILE ||
    process.env.HOME ||
    path.dirname(process.env.APPDATA || process.env.LOCALAPPDATA || "");

  if (baseFolder === "appdata") {
    return process.env.APPDATA || "";
  }

  if (baseFolder === "localAppData") {
    return process.env.LOCALAPPDATA || "";
  }

  if (baseFolder === "localLow") {
    if (!userProfile) {
      return "";
    }

    return path.join(userProfile, "AppData", "LocalLow");
  }

  return "";
}

function resolveWindowsKnownFolderPath(payload) {
  const baseFolder = String(payload?.baseFolder || "");
  const pathSegments = normalizeRelativeSegments(payload?.path || "", {
    allowEmpty: false,
  });
  const baseRoot = getKnownFolderRoot(baseFolder);

  if (!baseRoot || pathSegments.length === 0) {
    return "";
  }

  return path.join(baseRoot, ...pathSegments);
}

function resolveSaveProfileDestinationPath(profile, installDirectory) {
  const strategyType = String(profile?.strategy?.type || "");
  const payload = profile?.strategy?.payload || {};

  if (strategyType === "install-relative") {
    const relativeSegments = normalizeRelativeSegments(payload.relativePath, {
      allowEmpty: false,
    });
    if (!installDirectory || relativeSegments.length === 0) {
      return "";
    }

    return path.join(installDirectory, ...relativeSegments);
  }

  if (strategyType === "install-file-patterns") {
    const relativeSegments = normalizeRelativeSegments(payload.relativePath, {
      allowEmpty: true,
    });
    if (!installDirectory) {
      return "";
    }

    return relativeSegments.length > 0
      ? path.join(installDirectory, ...relativeSegments)
      : installDirectory;
  }

  if (strategyType === "windows-known-folder") {
    return resolveWindowsKnownFolderPath(payload);
  }

  if (strategyType === "renpy-appdata") {
    const folderSegments = normalizeRelativeSegments(payload.folderName, {
      allowEmpty: false,
    });
    if (folderSegments.length !== 1) {
      return "";
    }

    const appDataRoot = getKnownFolderRoot("appdata");
    if (!appDataRoot) {
      return "";
    }

    return path.join(appDataRoot, "RenPy", folderSegments[0]);
  }

  return "";
}

function getVaultBaseFolderToken(baseFolder) {
  if (baseFolder === "appdata") {
    return "roaming";
  }

  if (baseFolder === "localAppData") {
    return "local";
  }

  if (baseFolder === "localLow") {
    return "local-low";
  }

  return "misc";
}

function buildTrackedProfileDescriptor(profile, fallbackIndex) {
  const strategyType = String(profile?.strategy?.type || "");
  const payload = profile?.strategy?.payload || {};

  if (strategyType === "install-relative") {
    const relativeSegments = normalizeRelativeSegments(payload.relativePath, {
      allowEmpty: false,
    });
    if (relativeSegments.length === 0) {
      return null;
    }

    return {
      provider: profile.provider || "local",
      rootPath: profile.rootPath,
      strategy: {
        type: "install-relative",
        payload: {
          relativePath: relativeSegments.join("/"),
        },
      },
      confidence: Number(profile.confidence) || 0,
      reasons: Array.isArray(profile.reasons) ? profile.reasons : [],
      vaultRelativePath: path.join("profiles", "local", ...relativeSegments),
    };
  }

  if (strategyType === "install-file-patterns") {
    const relativeSegments = normalizeRelativeSegments(payload.relativePath, {
      allowEmpty: true,
    });
    const filePatterns = sanitizeFilePatterns(payload.filePatterns);
    if (filePatterns.length === 0) {
      return null;
    }

    return {
      provider: profile.provider || "local",
      rootPath: profile.rootPath,
      strategy: {
        type: "install-file-patterns",
        payload: {
          relativePath: relativeSegments.join("/"),
          filePatterns,
        },
      },
      confidence: Number(profile.confidence) || 0,
      reasons: Array.isArray(profile.reasons) ? profile.reasons : [],
      vaultRelativePath: relativeSegments.length > 0
        ? path.join("profiles", "local-files", ...relativeSegments)
        : path.join("profiles", "local-files", "root"),
    };
  }

  if (strategyType === "windows-known-folder") {
    const pathSegments = normalizeRelativeSegments(payload.path, {
      allowEmpty: false,
    });
    const baseFolder = String(payload.baseFolder || "");

    if (!baseFolder || pathSegments.length === 0) {
      return null;
    }

    return {
      provider: profile.provider || "local",
      rootPath: profile.rootPath,
      strategy: {
        type: "windows-known-folder",
        payload: {
          baseFolder,
          path: pathSegments.join("/"),
        },
      },
      confidence: Number(profile.confidence) || 0,
      reasons: Array.isArray(profile.reasons) ? profile.reasons : [],
      vaultRelativePath: path.join(
        "profiles",
        getVaultBaseFolderToken(baseFolder),
        ...pathSegments,
      ),
    };
  }

  if (strategyType === "renpy-appdata") {
    const folderSegments = normalizeRelativeSegments(payload.folderName, {
      allowEmpty: false,
    });
    if (folderSegments.length !== 1) {
      return null;
    }

    return {
      provider: profile.provider || "renpy_appdata",
      rootPath: profile.rootPath,
      strategy: {
        type: "renpy-appdata",
        payload: {
          folderName: folderSegments[0],
        },
      },
      confidence: Number(profile.confidence) || 0,
      reasons: Array.isArray(profile.reasons) ? profile.reasons : [],
      vaultRelativePath: path.join(
        "profiles",
        "roaming",
        "RenPy",
        folderSegments[0],
      ),
    };
  }

  const fallbackToken = normalizeIdentityToken(
    path.basename(profile?.rootPath || "") || `profile-${fallbackIndex}`,
    `profile-${fallbackIndex}`,
  );

  return {
    provider: profile?.provider || "local",
    rootPath: profile?.rootPath || "",
    strategy: {
      type: strategyType || "unknown",
      payload,
    },
    confidence: Number(profile?.confidence) || 0,
    reasons: Array.isArray(profile?.reasons) ? profile.reasons : [],
    vaultRelativePath: path.join("profiles", "misc", fallbackToken),
  };
}

async function walkDirectoryFiles(rootPath, prefixPath = "") {
  const stat = await fs.promises.stat(rootPath);
  if (stat.isFile()) {
    return [
      {
        filePath: rootPath,
        relativePath: prefixPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      },
    ];
  }

  const entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const nextRelativePath = prefixPath
      ? `${prefixPath}/${entry.name}`
      : entry.name;
    collected.push(
      ...(await walkDirectoryFiles(path.join(rootPath, entry.name), nextRelativePath)),
    );
  }

  return collected;
}

async function listPatternMatchedFiles(rootPath, filePatterns) {
  const patterns = sanitizeFilePatterns(filePatterns);
  if (patterns.length === 0 || !(await pathExists(rootPath))) {
    return [];
  }

  const stat = await fs.promises.stat(rootPath);
  if (!stat.isDirectory()) {
    return [];
  }

  const entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || !matchFilePatterns(entry.name, patterns)) {
      continue;
    }

    const filePath = path.join(rootPath, entry.name);
    const fileStat = await fs.promises.stat(filePath);
    files.push({
      filePath,
      relativePath: entry.name,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    });
  }

  return files;
}

async function listSaveProfileFiles(profile) {
  const strategyType = String(profile?.strategy?.type || "");

  if (strategyType === "install-file-patterns") {
    return listPatternMatchedFiles(
      profile.rootPath,
      profile?.strategy?.payload?.filePatterns,
    );
  }

  return walkDirectoryFiles(profile.rootPath);
}

module.exports = {
  buildTrackedProfileDescriptor,
  getKnownFolderRoot,
  listSaveProfileFiles,
  matchFilePatterns,
  normalizeIdentityToken,
  normalizeRelativeSegments,
  pathExists,
  pathExistsSync,
  resolveSaveProfileDestinationPath,
  sanitizeFilePatterns,
};
