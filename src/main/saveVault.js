const fs = require("fs");
const path = require("path");
const {
  buildTrackedProfileDescriptor,
  listSaveProfileFiles,
  normalizeIdentityToken,
  resolveSaveProfileDestinationPath,
} = require("./saveProfileStrategies");

const COMMON_SAVE_PATHS = [
  "game/saves",
  "saves",
  "save",
  "www/save",
  "www/saves",
  "userdata/save",
  "userdata/saves",
];

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

async function copyProfileToVault(profile, destinationRoot) {
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  const files = await listSaveProfileFiles(profile);

  for (const file of files) {
    await copyPathRecursive(
      file.filePath,
      path.join(destinationRoot, ...String(file.relativePath || "").split("/")),
      true,
    );
  }
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
    await copyProfileToVault(trackedProfile, destinationPath);
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
      .map((entry) => {
        if (entry.strategy?.type === "install-relative") {
          return entry.strategy.payload.relativePath;
        }

        if (entry.strategy?.type === "install-file-patterns") {
          return entry.strategy.payload.relativePath || entry.rootPath;
        }

        return entry.rootPath;
      }),
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
