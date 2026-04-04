const fs = require("fs");
const path = require("path");

const COMMON_SAVE_PATHS = [
  "game/saves",
  "saves",
  "save",
  "www/save",
  "www/saves",
  "userdata/save",
  "userdata/saves",
];

function normalizeIdentityToken(value, fallback = "unknown") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function extractThreadId(threadUrl) {
  const match = String(threadUrl || "").match(/\/threads\/[^./]+?\.(\d+)(?:\/|$)/i);
  return match ? match[1] : "";
}

function buildSaveVaultIdentity(input) {
  const f95Id = extractThreadId(input?.threadUrl || "");
  if (f95Id) {
    return `f95-${f95Id}`;
  }

  if (input?.atlasId) {
    return `atlas-${normalizeIdentityToken(input.atlasId)}`;
  }

  const titleToken = normalizeIdentityToken(input?.title || "");
  const creatorToken = normalizeIdentityToken(input?.creator || "");
  return `title-${titleToken}__creator-${creatorToken}`;
}

function getVaultRoot(appPaths) {
  return path.join(appPaths.backups, "save_vault");
}

function getVaultGameRoot(appPaths, identity) {
  return path.join(getVaultRoot(appPaths), identity);
}

function normalizeRelativeSegments(value) {
  const rawSegments = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (
    rawSegments.length === 0 ||
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

function resolveSaveProfileDestinationPath(profile, installDirectory) {
  const strategyType = String(profile?.strategy?.type || "");
  const payload = profile?.strategy?.payload || {};

  if (strategyType === "install-relative") {
    const relativeSegments = normalizeRelativeSegments(payload.relativePath);
    if (!installDirectory || relativeSegments.length === 0) {
      return "";
    }

    return path.join(installDirectory, ...relativeSegments);
  }

  if (strategyType === "renpy-appdata") {
    const folderSegments = normalizeRelativeSegments(payload.folderName);
    if (folderSegments.length !== 1) {
      return "";
    }

    const appDataRoot = process.env.APPDATA || "";
    if (!appDataRoot) {
      return "";
    }

    return path.join(appDataRoot, "RenPy", folderSegments[0]);
  }

  return "";
}

function buildTrackedProfileDescriptor(profile, fallbackIndex) {
  const strategyType = String(profile?.strategy?.type || "");
  const payload = profile?.strategy?.payload || {};

  if (strategyType === "install-relative") {
    const relativeSegments = normalizeRelativeSegments(payload.relativePath);
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

  if (strategyType === "renpy-appdata") {
    const folderSegments = normalizeRelativeSegments(payload.folderName);
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
      vaultRelativePath: path.join("profiles", "renpy", folderSegments[0]),
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

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFallbackTrackedProfiles(installDirectory) {
  const trackedProfiles = [];

  for (const relativePath of COMMON_SAVE_PATHS) {
    const fullPath = path.join(installDirectory, ...relativePath.split("/"));
    if (await pathExists(fullPath)) {
      trackedProfiles.push({
        provider: "local",
        rootPath: fullPath,
        strategy: {
          type: "install-relative",
          payload: {
            relativePath,
          },
        },
        confidence: 100,
        reasons: [`found local save directory at ${relativePath}`],
        vaultRelativePath: path.join("profiles", "local", ...relativePath.split("/")),
      });
    }
  }

  return trackedProfiles;
}

async function resolveTrackedProfiles(input) {
  const seenRoots = new Set();
  const trackedProfiles = [];
  const inputProfiles = Array.isArray(input?.profiles) ? input.profiles : [];

  for (const [index, profile] of inputProfiles.entries()) {
    if (!profile?.rootPath || !(await pathExists(profile.rootPath))) {
      continue;
    }

    const descriptor = buildTrackedProfileDescriptor(profile, index);
    if (!descriptor || seenRoots.has(descriptor.rootPath)) {
      continue;
    }

    seenRoots.add(descriptor.rootPath);
    trackedProfiles.push(descriptor);
  }

  if (trackedProfiles.length > 0) {
    return trackedProfiles;
  }

  if (!input?.installDirectory) {
    return [];
  }

  return listFallbackTrackedProfiles(input.installDirectory);
}

async function copyPathRecursive(sourcePath, destinationPath, overwrite) {
  const stat = await fs.promises.stat(sourcePath);

  if (stat.isDirectory()) {
    await fs.promises.mkdir(destinationPath, { recursive: true });
    const entries = await fs.promises.readdir(sourcePath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      await copyPathRecursive(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
        overwrite,
      );
    }

    return;
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (!overwrite && (await pathExists(destinationPath))) {
    return;
  }

  await fs.promises.copyFile(sourcePath, destinationPath);
}

async function backupGameSaves(input) {
  const identity = buildSaveVaultIdentity(input);
  const trackedProfiles = await resolveTrackedProfiles(input);

  if (trackedProfiles.length === 0) {
    return {
      identity,
      backedUpProfiles: [],
      backedUpPaths: [],
    };
  }

  const vaultRoot = getVaultGameRoot(input.appPaths, identity);
  await fs.promises.rm(vaultRoot, { recursive: true, force: true });
  await fs.promises.mkdir(vaultRoot, { recursive: true });

  for (const trackedProfile of trackedProfiles) {
    const destinationPath = path.join(vaultRoot, trackedProfile.vaultRelativePath);
    await copyPathRecursive(trackedProfile.rootPath, destinationPath, true);
  }

  await fs.promises.writeFile(
    path.join(vaultRoot, "manifest.json"),
    JSON.stringify(
      {
        identity,
        threadUrl: input.threadUrl || "",
        atlasId: input.atlasId || "",
        title: input.title || "",
        creator: input.creator || "",
        updatedAt: Date.now(),
        trackedPaths: trackedProfiles
          .filter((entry) => entry.strategy?.type === "install-relative")
          .map((entry) => entry.strategy.payload.relativePath),
        trackedProfiles: trackedProfiles.map((entry) => ({
          provider: entry.provider,
          rootPath: entry.rootPath,
          strategy: entry.strategy,
          confidence: entry.confidence,
          reasons: entry.reasons,
          vaultRelativePath: entry.vaultRelativePath.replace(/\\/g, "/"),
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    identity,
    backedUpProfiles: trackedProfiles.map((entry) => ({
      rootPath: entry.rootPath,
      strategy: entry.strategy,
    })),
    backedUpPaths: trackedProfiles
      .filter((entry) => entry.strategy?.type === "install-relative")
      .map((entry) => entry.strategy.payload.relativePath),
  };
}

async function restoreGameSaves(input) {
  const identity = buildSaveVaultIdentity(input);
  const vaultRoot = getVaultGameRoot(input.appPaths, identity);

  if (!(await pathExists(vaultRoot))) {
    return {
      identity,
      restoredPaths: [],
    };
  }

  const manifestPath = path.join(vaultRoot, "manifest.json");
  let trackedPaths = [];
  let trackedProfiles = [];

  if (await pathExists(manifestPath)) {
    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(manifestPath, "utf8"),
      );
      trackedPaths = Array.isArray(manifest?.trackedPaths)
        ? manifest.trackedPaths
        : [];
      trackedProfiles = Array.isArray(manifest?.trackedProfiles)
        ? manifest.trackedProfiles
        : [];
    } catch (error) {
      trackedPaths = [];
      trackedProfiles = [];
    }
  }

  if (trackedProfiles.length > 0) {
    const restoredPaths = [];

    for (const trackedProfile of trackedProfiles) {
      const sourcePath = path.join(
        vaultRoot,
        ...String(trackedProfile.vaultRelativePath || "")
          .split("/")
          .filter(Boolean),
      );
      if (!(await pathExists(sourcePath))) {
        continue;
      }

      const destinationPath = resolveSaveProfileDestinationPath(
        trackedProfile,
        input.installDirectory,
      );
      if (!destinationPath) {
        continue;
      }

      await copyPathRecursive(
        sourcePath,
        destinationPath,
        Boolean(input.overwrite),
      );
      restoredPaths.push(
        trackedProfile.strategy?.type === "install-relative"
          ? trackedProfile.strategy?.payload?.relativePath ||
              trackedProfile.rootPath ||
              destinationPath
          : trackedProfile.rootPath || destinationPath,
      );
    }

    return {
      identity,
      restoredPaths,
    };
  }

  if (trackedPaths.length === 0) {
    trackedPaths = COMMON_SAVE_PATHS.filter((relativePath) =>
      fs.existsSync(path.join(vaultRoot, ...relativePath.split("/"))),
    );
  }

  const restoredPaths = [];

  for (const relativePath of trackedPaths) {
    const sourcePath = path.join(vaultRoot, ...relativePath.split("/"));
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const destinationPath = path.join(
      input.installDirectory,
      ...relativePath.split("/"),
    );
    await copyPathRecursive(
      sourcePath,
      destinationPath,
      Boolean(input.overwrite),
    );
    restoredPaths.push(relativePath);
  }

  return {
    identity,
    restoredPaths,
  };
}

module.exports = {
  backupGameSaves,
  buildSaveVaultIdentity,
  resolveSaveProfileDestinationPath,
  restoreGameSaves,
};
