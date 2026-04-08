const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { buildSaveManifest } = require("../shared/saveManifest");
const { decideSaveSyncPlan } = require("../shared/saveSyncPlan");
const { getCloudSyncErrorDetails } = require("../shared/cloudSyncErrors");
const {
  createSupabaseDesktopClient,
  resolveSupabaseSettings,
} = require("./supabase/client");
const {
  backupGameSaves,
} = require("./saveVault");
const {
  buildCloudLibraryCatalogEntry,
  buildCloudLibraryEntryIdentityCandidates,
  getRemoteOnlyCloudLibraryEntries,
  mergeCloudLibraryCatalogEntries,
  normalizeCatalogUrl,
  parseCloudLibraryCatalogManifest,
} = require("./cloudLibraryCatalog");
const {
  buildTrackedProfileDescriptor,
  listSaveProfileFiles,
  normalizeIdentityToken,
  resolveSaveProfileDestinationPath,
} = require("./saveProfileStrategies");
const { enrichSupabaseStorageError } = require("../shared/supabaseStorageErrors");

function createTempPath(appPaths, name) {
  const targetPath = path.join(
    appPaths.cache,
    "cloud-sync",
    `${Date.now()}-${name}`,
  );
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  return targetPath;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function getArchiveRoot(profile, index) {
  const descriptor = buildTrackedProfileDescriptor(profile, index);
  if (descriptor?.vaultRelativePath) {
    return descriptor.vaultRelativePath.replace(/\\/g, "/");
  }

  return `profiles/misc/${normalizeIdentityToken(profile?.provider || "", `profile-${index}`)}`;
}

function getRemotePaths(authUserId, cloudIdentity) {
  const remoteBase = `${authUserId}/${cloudIdentity}`;
  const historyStamp = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  return {
    remoteBase,
    latestArchivePath: `${remoteBase}/latest.zip`,
    latestManifestPath: `${remoteBase}/latest.manifest.json`,
    historyArchivePath: `${remoteBase}/history/${historyStamp}.zip`,
  };
}

function getCloudLibraryRemotePaths(authUserId) {
  const remoteBase = `${authUserId}/library`;
  const historyStamp = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  return {
    remoteBase,
    latestManifestPath: `${remoteBase}/catalog.json`,
    historyManifestPath: `${remoteBase}/history/${historyStamp}.json`,
  };
}

function normalizeCloudLibraryIdentityKeys(values) {
  const normalizedKeys = [];
  const seenKeys = new Set();

  for (const rawValue of Array.isArray(values) ? values : []) {
    const identityKey = String(rawValue || "").trim();
    if (!identityKey || seenKeys.has(identityKey)) {
      continue;
    }

    seenKeys.add(identityKey);
    normalizedKeys.push(identityKey);
  }

  return normalizedKeys;
}

function filterCloudLibraryEntriesByIdentity(entries, excludedIdentityKeys) {
  const excludedSet = new Set(
    normalizeCloudLibraryIdentityKeys(excludedIdentityKeys),
  );
  if (excludedSet.size === 0) {
    return Array.isArray(entries) ? [...entries] : [];
  }

  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const identityKey = String(entry?.identityKey || "").trim();
    return Boolean(identityKey) && !excludedSet.has(identityKey);
  });
}

function buildCloudLibraryCatalogSnapshot(
  localEntries,
  remoteEntries,
  options = {},
) {
  const excludedIdentityKeys = normalizeCloudLibraryIdentityKeys(
    options?.excludedIdentityKeys,
  );
  const normalizedLocalEntries = filterCloudLibraryEntriesByIdentity(
    localEntries,
    excludedIdentityKeys,
  );
  const normalizedRemoteEntries = filterCloudLibraryEntriesByIdentity(
    remoteEntries,
    excludedIdentityKeys,
  );
  const mergedEntries = mergeCloudLibraryCatalogEntries(
    normalizedLocalEntries,
    normalizedRemoteEntries,
  );

  return {
    excludedIdentityKeys,
    localEntries: normalizedLocalEntries,
    remoteEntries: normalizedRemoteEntries,
    mergedEntries,
    remoteOnlyEntries: getRemoteOnlyCloudLibraryEntries(
      mergedEntries,
      normalizedLocalEntries,
    ),
  };
}

function normalizeCloudLibraryDeleteTarget(input) {
  const candidateIdentityKeys = normalizeCloudLibraryIdentityKeys(
    input?.candidateIdentityKeys ||
      buildCloudLibraryEntryIdentityCandidates({
        atlasId: input?.atlasId,
        f95Id: input?.f95Id,
        siteUrl: input?.siteUrl,
        title: input?.title,
        creator: input?.creator,
      }),
  );

  return {
    requestKey: String(input?.requestKey || "").trim(),
    preferredIdentityKey:
      String(input?.preferredIdentityKey || "").trim() ||
      candidateIdentityKeys[0] ||
      "",
    candidateIdentityKeys,
    atlasId: String(input?.atlasId || "").trim(),
    f95Id: String(input?.f95Id || "").trim(),
    siteUrl: normalizeCatalogUrl(input?.siteUrl),
    title: String(input?.title || "").trim(),
    creator: String(input?.creator || "").trim(),
  };
}

function normalizeCloudLibraryDeleteTargets(inputs) {
  return (Array.isArray(inputs) ? inputs : [])
    .map((input) => normalizeCloudLibraryDeleteTarget(input))
    .filter(
      (target) =>
        target.preferredIdentityKey ||
        target.atlasId ||
        target.f95Id ||
        target.siteUrl,
    );
}

function shouldRemoveCloudLibraryEntry(entry, target) {
  const candidateIdentityKey = String(entry?.identityKey || "").trim();
  if (
    candidateIdentityKey &&
    target.candidateIdentityKeys.includes(candidateIdentityKey)
  ) {
    return true;
  }

  if (target.atlasId && String(entry?.atlasId || "").trim() === target.atlasId) {
    return true;
  }

  if (target.f95Id && String(entry?.f95Id || "").trim() === target.f95Id) {
    return true;
  }

  if (
    target.siteUrl &&
    normalizeCatalogUrl(entry?.siteUrl) === target.siteUrl
  ) {
    return true;
  }

  return false;
}

function isStorageNotFoundError(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || "").toLowerCase();
  const original = error.originalError;
  const responseStatus =
    original instanceof Response ? original.status : null;

  return (
    error.statusCode === 404 ||
    error.status === 404 ||
    responseStatus === 404 ||
    message.includes("not found") ||
    message.includes("no such object") ||
    message.includes("does not exist") ||
    message.includes("object not found")
  );
}

async function buildLocalSaveManifest(identity, profiles) {
  const manifestProfiles = [];
  const manifestEntries = [];

  for (const [index, profile] of profiles.entries()) {
    const archiveRoot = getArchiveRoot(profile, index);
    const files = await listSaveProfileFiles(profile);

    for (const file of files) {
      const archivePath = `${archiveRoot}/${file.relativePath}`.replace(/\\/g, "/");
      manifestEntries.push({
        path: archivePath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        sha256: await hashFile(file.filePath),
      });
    }

    manifestProfiles.push({
      provider: profile.provider,
      rootPath: profile.rootPath,
      strategy: profile.strategy,
      archiveRoot,
      confidence: profile.confidence,
      reasons: profile.reasons,
    });
  }

  return buildSaveManifest({
    identity,
    profiles: manifestProfiles,
    entries: manifestEntries,
  });
}

function getPrimaryInstallDirectory(game) {
  const versions = Array.isArray(game?.versions) ? [...game.versions] : [];
  versions.sort((left, right) => (right.date_added || 0) - (left.date_added || 0));

  for (const version of versions) {
    if (version?.game_path) {
      return version.game_path;
    }
  }

  return "";
}

function buildVaultBackupInput(appPaths, snapshot) {
  const game = snapshot?.game || null;
  if (!game) {
    return null;
  }

  return {
    appPaths,
    threadUrl: game?.siteUrl || "",
    atlasId: game?.atlas_id || "",
    title: game?.displayTitle || game?.title || "",
    creator: game?.displayCreator || game?.creator || "",
    installDirectory: getPrimaryInstallDirectory(game),
    profiles: snapshot?.profiles || [],
  };
}

async function refreshLocalVaultCopy(appPaths, snapshot) {
  const backupInput = buildVaultBackupInput(appPaths, snapshot);
  if (!backupInput) {
    return null;
  }

  return backupGameSaves(backupInput);
}

async function buildCloudSaveArchive(appPaths, identity, profiles) {
  const zip = new AdmZip();
  const manifestProfiles = [];
  const manifestEntries = [];

  for (const [index, profile] of profiles.entries()) {
    const archiveRoot = getArchiveRoot(profile, index);
    const files = await listSaveProfileFiles(profile);

    for (const file of files) {
      const archivePath = `${archiveRoot}/${file.relativePath}`.replace(/\\/g, "/");
      const fileBuffer = await fs.promises.readFile(file.filePath);
      zip.addFile(archivePath, fileBuffer);
      manifestEntries.push({
        path: archivePath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        sha256: await hashFile(file.filePath),
      });
    }

    manifestProfiles.push({
      provider: profile.provider,
      rootPath: profile.rootPath,
      strategy: profile.strategy,
      archiveRoot,
      confidence: profile.confidence,
      reasons: profile.reasons,
    });
  }

  const manifest = buildSaveManifest({
    identity,
    profiles: manifestProfiles,
    entries: manifestEntries,
  });
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

  const archivePath = createTempPath(appPaths, "cloud-save.zip");
  await fs.promises.writeFile(archivePath, zip.toBuffer());

  return {
    archivePath,
    manifest,
  };
}

async function copyDirectoryRecursive(sourcePath, destinationPath, overwrite) {
  const stat = await fs.promises.stat(sourcePath);
  if (stat.isDirectory()) {
    await fs.promises.mkdir(destinationPath, { recursive: true });
    const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyDirectoryRecursive(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
        overwrite,
      );
    }
    return;
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (!overwrite && fs.existsSync(destinationPath)) {
    return;
  }
  await fs.promises.copyFile(sourcePath, destinationPath);
}

function createCloudSaveService({
  appPaths,
  getConfig,
  getSaveProfileSnapshot,
  refreshSaveProfiles,
  listGames,
  upsertSaveSyncState,
}) {
  let cachedBundle = null;
  let cachedSignature = "";
  let authSubscription = null;
  const authListeners = new Set();

  const emitAuthStateChange = async () => {
    try {
      const state = await getAuthState();
      for (const listener of authListeners) {
        try {
          listener(state);
        } catch (error) {
          console.error("[cloud.auth] Listener failed:", error);
        }
      }
    } catch (error) {
      console.error("[cloud.auth] Failed to emit auth state:", error);
    }
  };

  const getClientBundle = () => {
    const nextSettings = resolveSupabaseSettings(getConfig());
    const nextSignature = JSON.stringify(nextSettings);

    if (nextSignature === cachedSignature && cachedBundle) {
      return cachedBundle;
    }

    const bundle = createSupabaseDesktopClient(appPaths, getConfig());

    if (nextSignature !== cachedSignature) {
      if (authSubscription?.unsubscribe) {
        authSubscription.unsubscribe();
      }

      cachedBundle = bundle;
      cachedSignature = nextSignature;

      if (bundle.client) {
        const authResult = bundle.client.auth.onAuthStateChange(() => {
          emitAuthStateChange().catch((error) => {
            console.error("[cloud.auth] Failed to broadcast auth change:", error);
          });
        });
        authSubscription = authResult?.data?.subscription || null;
      } else {
        authSubscription = null;
      }
    }

    return cachedBundle || bundle;
  };

  const withConfiguredClient = async () => {
    const bundle = getClientBundle();
    if (!bundle.client || !bundle.settings.isConfigured) {
      throw new Error(
        "Supabase cloud sync is not configured. Add a project URL and publishable key first.",
      );
    }

    return bundle;
  };

  const getAuthState = async () => {
    const bundle = getClientBundle();
    if (!bundle.client) {
      return {
        configured: false,
        authenticated: false,
        user: null,
        error: "",
        settings: bundle.settings,
      };
    }

    const {
      data: { session },
    } = await bundle.client.auth.getSession();
    let user = null;

    if (session?.access_token) {
      const userResult = await bundle.client.auth.getUser();
      if (userResult.error) {
        throw userResult.error;
      }

      user = userResult.data.user || null;
    }

    return {
      configured: bundle.settings.isConfigured,
      authenticated: Boolean(user || session?.user),
      user: user || session?.user
        ? {
            id: (user || session.user).id,
            email: (user || session.user).email || "",
          }
        : null,
      error: "",
      settings: bundle.settings,
    };
  };

  const signUpWithPassword = async ({ email, password }) => {
    const bundle = await withConfiguredClient();
    const { data, error } = await bundle.client.auth.signUp({
      email: String(email || "").trim(),
      password,
    });
    if (error) {
      throw error;
    }

    return {
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email || "",
          }
        : null,
      session: data.session || null,
    };
  };

  const signInWithPassword = async ({ email, password }) => {
    const bundle = await withConfiguredClient();
    const { data, error } = await bundle.client.auth.signInWithPassword({
      email: String(email || "").trim(),
      password,
    });
    if (error) {
      throw error;
    }

    return {
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email || "",
          }
        : null,
      session: data.session || null,
    };
  };

  const signOut = async () => {
    const bundle = await withConfiguredClient();
    const { error } = await bundle.client.auth.signOut();
    if (error) {
      throw error;
    }
  };

  const listLocalLibraryEntries = async () => {
    if (typeof listGames !== "function") {
      return [];
    }

    const games = await listGames();
    return (Array.isArray(games) ? games : [])
      .map((game) => buildCloudLibraryCatalogEntry(game))
      .filter(Boolean);
  };

  const fetchRemoteManifest = async ({ bundle, authUserId, cloudIdentity }) => {
    const remotePaths = getRemotePaths(authUserId, cloudIdentity);
    const downloadResult = await bundle.client.storage
      .from(bundle.settings.storageBucket)
      .download(remotePaths.latestManifestPath);

    if (downloadResult.error || !downloadResult.data) {
      if (downloadResult.error) {
        const enriched = await enrichSupabaseStorageError(downloadResult.error);
        if (isStorageNotFoundError(enriched)) {
          return {
            exists: false,
            manifest: null,
            remotePaths,
          };
        }
        throw enriched;
      }

      throw new Error("Failed to download cloud save manifest.");
    }

    const manifest = JSON.parse(
      Buffer.from(await downloadResult.data.arrayBuffer()).toString("utf8"),
    );

    return {
      exists: true,
      manifest,
      remotePaths,
    };
  };

  const fetchRemoteLibraryCatalog = async ({ bundle, authUserId }) => {
    const remotePaths = getCloudLibraryRemotePaths(authUserId);
    const downloadResult = await bundle.client.storage
      .from(bundle.settings.storageBucket)
      .download(remotePaths.latestManifestPath);

    if (downloadResult.error || !downloadResult.data) {
      if (downloadResult.error) {
        const enriched = await enrichSupabaseStorageError(downloadResult.error);
        if (isStorageNotFoundError(enriched)) {
          return {
            exists: false,
            manifest: parseCloudLibraryCatalogManifest(null),
            remotePaths,
          };
        }
        throw enriched;
      }

      throw new Error("Failed to download cloud library catalog.");
    }

    const manifest = parseCloudLibraryCatalogManifest(
      JSON.parse(Buffer.from(await downloadResult.data.arrayBuffer()).toString("utf8")),
    );

    return {
      exists: true,
      manifest,
      remotePaths,
    };
  };

  const uploadCloudLibraryCatalog = async ({ bundle, authUserId, entries }) => {
    const remotePaths = getCloudLibraryRemotePaths(authUserId);
    const manifest = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries,
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

    const uploadResult = await bundle.client.storage
      .from(bundle.settings.storageBucket)
      .upload(remotePaths.latestManifestPath, manifestBuffer, {
        contentType: "application/json",
        upsert: true,
      });
    if (uploadResult.error) {
      throw await enrichSupabaseStorageError(uploadResult.error);
    }

    const historyUpload = await bundle.client.storage
      .from(bundle.settings.storageBucket)
      .upload(remotePaths.historyManifestPath, manifestBuffer, {
        contentType: "application/json",
        upsert: false,
      });
    if (historyUpload.error) {
      const historyErr = await enrichSupabaseStorageError(historyUpload.error);
      console.warn(
        "[cloud.library] History manifest upload skipped:",
        historyErr.message,
      );
    }

    return {
      manifest,
      remotePaths,
    };
  };

  const uploadGameSaves = async ({ recordId, snapshot: providedSnapshot = null }) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();
    if (!authState.user?.id) {
      throw new Error("Cloud save upload requires a signed-in Supabase user.");
    }

    const snapshot = providedSnapshot || (await getSaveProfileSnapshot(recordId));
    const game = snapshot?.game || null;
    const profiles = snapshot?.profiles || [];
    if (profiles.length === 0) {
      throw new Error("No local save profiles were detected for this game.");
    }

    const cloudIdentity = snapshot?.syncState?.cloudIdentity || "";
    if (!cloudIdentity) {
      throw new Error("No cloud identity is registered for this game.");
    }

    await refreshLocalVaultCopy(appPaths, snapshot).catch((error) => {
      console.warn("[save.vault] Failed to refresh local vault copy:", error);
    });

    const { archivePath, manifest } = await buildCloudSaveArchive(
      appPaths,
      cloudIdentity,
      profiles,
    );
    const archiveBuffer = await fs.promises.readFile(archivePath);
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const remotePaths = getRemotePaths(authState.user.id, cloudIdentity);

    try {
      const archiveUpload = await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .upload(remotePaths.latestArchivePath, archiveBuffer, {
          contentType: "application/zip",
          upsert: true,
        });
      if (archiveUpload.error) {
        throw await enrichSupabaseStorageError(archiveUpload.error);
      }

      const manifestUpload = await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .upload(remotePaths.latestManifestPath, manifestBuffer, {
          contentType: "application/json",
          upsert: true,
        });
      if (manifestUpload.error) {
        throw await enrichSupabaseStorageError(manifestUpload.error);
      }

      const historyArchive = await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .upload(remotePaths.historyArchivePath, archiveBuffer, {
          contentType: "application/zip",
          upsert: false,
        });
      if (historyArchive.error) {
        const historyErr = await enrichSupabaseStorageError(historyArchive.error);
        console.warn(
          "[cloud.sync] History archive upload skipped:",
          historyErr.message,
        );
      }

      const state = await upsertSaveSyncState({
        recordId,
        cloudIdentity,
        lastLocalManifestHash: manifest.manifestHash,
        lastRemoteManifestHash: manifest.manifestHash,
        lastUploadedAt: new Date().toISOString(),
        lastRemotePath: remotePaths.latestArchivePath,
        syncStatus: "uploaded",
        lastError: "",
      });

      return {
        uploaded: true,
        remotePath: remotePaths.latestArchivePath,
        manifestHash: manifest.manifestHash,
        game,
        syncState: state,
      };
    } catch (error) {
      const normalizedError = getCloudSyncErrorDetails(
        await enrichSupabaseStorageError(error),
        {
          action: "upload",
          archiveBytes: archiveBuffer.length,
        },
      );
      console.error("[cloud.sync] Upload failed:", {
        code: normalizedError.code,
        rawMessage: normalizedError.rawMessage,
      });
      await upsertSaveSyncState({
        recordId,
        cloudIdentity,
        lastLocalManifestHash: manifest.manifestHash,
        lastRemoteManifestHash: snapshot?.syncState?.lastRemoteManifestHash || "",
        lastUploadedAt: snapshot?.syncState?.lastUploadedAt || "",
        lastDownloadedAt: snapshot?.syncState?.lastDownloadedAt || "",
        lastRemotePath: snapshot?.syncState?.lastRemotePath || "",
        syncStatus: "error",
        lastError: normalizedError.userMessage,
      });
      throw new Error(normalizedError.userMessage);
    } finally {
      await fs.promises.unlink(archivePath).catch(() => {});
    }
  };

  const restoreGameSaves = async ({
    recordId,
    remoteArchivePath: requestedRemoteArchivePath = "",
  }) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();
    if (!authState.user?.id) {
      throw new Error("Cloud save restore requires a signed-in Supabase user.");
    }

    const snapshot = await getSaveProfileSnapshot(recordId);
    const game = snapshot?.game || null;
    const syncState = snapshot?.syncState;
    if (!syncState?.cloudIdentity) {
      throw new Error("No cloud identity is registered for this game.");
    }

    const remotePaths = getRemotePaths(authState.user.id, syncState.cloudIdentity);
    const remoteArchivePath =
      requestedRemoteArchivePath ||
      syncState.lastRemotePath ||
      remotePaths.latestArchivePath;
    const archivePath = createTempPath(appPaths, "cloud-restore.zip");
    const extractionPath = createTempPath(appPaths, "cloud-restore");
    const installDirectory =
      game?.versions?.find((version) => version.game_path)?.game_path || "";

    try {
      const downloadResult = await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .download(remoteArchivePath);
      if (downloadResult.error || !downloadResult.data) {
        throw await enrichSupabaseStorageError(
          downloadResult.error ||
            new Error("Failed to download cloud save archive."),
        );
      }

      const arrayBuffer = await downloadResult.data.arrayBuffer();

      if (snapshot?.profiles?.length > 0) {
        await backupGameSaves({
          appPaths,
          threadUrl: game?.siteUrl || "",
          atlasId: game?.atlas_id || "",
          title: game?.displayTitle || game?.title || "",
          creator: game?.displayCreator || game?.creator || "",
          installDirectory,
          profiles: snapshot.profiles,
        });
      }

      await fs.promises.writeFile(archivePath, Buffer.from(arrayBuffer));
      const { extractArchiveSafely } = require("./archive/extractArchive");
      await extractArchiveSafely({
        archivePath,
        destinationPath: extractionPath,
      });

      const manifestPath = path.join(extractionPath, "manifest.json");
      const manifest = JSON.parse(
        await fs.promises.readFile(manifestPath, "utf8"),
      );

      for (const profile of manifest.profiles || []) {
        const sourceRoot = path.join(
          extractionPath,
          ...(String(profile.archiveRoot || "").split("/").filter(Boolean)),
        );
        const destinationRoot = resolveSaveProfileDestinationPath(
          profile,
          installDirectory,
        );
        if (!sourceRoot || !destinationRoot || !fs.existsSync(sourceRoot)) {
          continue;
        }

        await copyDirectoryRecursive(sourceRoot, destinationRoot, true);
      }

      const state = await upsertSaveSyncState({
        recordId,
        cloudIdentity: syncState.cloudIdentity,
        lastLocalManifestHash: syncState.lastLocalManifestHash,
        lastRemoteManifestHash:
          manifest.manifestHash || syncState.lastRemoteManifestHash || "",
        lastUploadedAt: syncState.lastUploadedAt || "",
        lastDownloadedAt: new Date().toISOString(),
        lastRemotePath: remoteArchivePath,
        syncStatus: "restored",
        lastError: "",
      });

      if (refreshSaveProfiles) {
        const refreshedSnapshot = await refreshSaveProfiles(recordId).catch(
          (refreshError) => {
            console.warn(
              "[save.profiles] Failed to refresh save profiles after cloud restore:",
              refreshError,
            );
            return null;
          },
        );

        if (refreshedSnapshot) {
          await refreshLocalVaultCopy(appPaths, refreshedSnapshot).catch(
            (vaultError) => {
              console.warn(
                "[save.vault] Failed to refresh local vault after cloud restore:",
                vaultError,
              );
            },
          );
        }
      }

      return {
        restored: true,
        game,
        manifestHash: manifest.manifestHash || "",
        syncState: state,
      };
    } catch (error) {
      const normalizedError = getCloudSyncErrorDetails(
        await enrichSupabaseStorageError(error),
        {
          action: "restore",
        },
      );
      console.error("[cloud.sync] Restore failed:", {
        code: normalizedError.code,
        rawMessage: normalizedError.rawMessage,
      });
      await upsertSaveSyncState({
        recordId,
        cloudIdentity: syncState.cloudIdentity,
        lastLocalManifestHash: syncState.lastLocalManifestHash || "",
        lastRemoteManifestHash: syncState.lastRemoteManifestHash || "",
        lastUploadedAt: syncState.lastUploadedAt || "",
        lastDownloadedAt: syncState.lastDownloadedAt || "",
        lastRemotePath: remoteArchivePath,
        syncStatus: "error",
        lastError: normalizedError.userMessage,
      });
      throw new Error(normalizedError.userMessage);
    } finally {
      await fs.promises
        .rm(extractionPath, { recursive: true, force: true })
        .catch(() => {});
      await fs.promises.unlink(archivePath).catch(() => {});
    }
  };

  const reconcileGameSaves = async ({ recordId }) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();

    if (!authState.user?.id) {
      return {
        reconciled: false,
        action: "noop",
        reason: "not-authenticated",
      };
    }

    const snapshot = refreshSaveProfiles
      ? await refreshSaveProfiles(recordId)
      : await getSaveProfileSnapshot(recordId);
    const cloudIdentity = snapshot?.syncState?.cloudIdentity || "";

    if (!snapshot?.game || !cloudIdentity) {
      return {
        reconciled: false,
        action: "noop",
        reason: "missing-game",
      };
    }

    const localManifest =
      Array.isArray(snapshot?.profiles) && snapshot.profiles.length > 0
        ? await buildLocalSaveManifest(cloudIdentity, snapshot.profiles)
        : null;

    if (localManifest) {
      await refreshLocalVaultCopy(appPaths, snapshot).catch((error) => {
        console.warn(
          "[save.vault] Failed to refresh local vault before cloud reconcile:",
          error,
        );
      });
    }

    const remoteResult = await fetchRemoteManifest({
      bundle,
      authUserId: authState.user.id,
      cloudIdentity,
    });
    const remoteManifest = remoteResult.manifest;
    const plan = decideSaveSyncPlan({
      localManifest,
      remoteManifest,
      syncState: snapshot?.syncState || null,
    });

    if (plan.action === "upload") {
      const result = await uploadGameSaves({
        recordId,
        snapshot,
      });

      return {
        reconciled: true,
        action: "upload",
        reason: plan.reason,
        result,
      };
    }

    if (plan.action === "restore") {
      const result = await restoreGameSaves({
        recordId,
        remoteArchivePath: remoteResult.remotePaths.latestArchivePath,
      });

      return {
        reconciled: true,
        action: "restore",
        reason: plan.reason,
        result,
      };
    }

    if (plan.action === "conflict") {
      const state = await upsertSaveSyncState({
        recordId,
        cloudIdentity,
        lastLocalManifestHash: localManifest?.manifestHash || "",
        lastRemoteManifestHash: remoteManifest?.manifestHash || "",
        lastUploadedAt: snapshot?.syncState?.lastUploadedAt || "",
        lastDownloadedAt: snapshot?.syncState?.lastDownloadedAt || "",
        lastRemotePath:
          remoteResult.remotePaths?.latestArchivePath ||
          snapshot?.syncState?.lastRemotePath ||
          "",
        syncStatus: "conflict",
        lastError:
          "Cloud and local saves changed independently with the same timestamp. Review before overwriting either copy.",
      });

      return {
        reconciled: false,
        action: "conflict",
        reason: plan.reason,
        syncState: state,
      };
    }

    const syncStatus =
      plan.reason === "already-synced" ? "synced" : snapshot?.syncState?.syncStatus || "idle";
    const state = await upsertSaveSyncState({
      recordId,
      cloudIdentity,
      lastLocalManifestHash:
        localManifest?.manifestHash || snapshot?.syncState?.lastLocalManifestHash || "",
      lastRemoteManifestHash:
        remoteManifest?.manifestHash ||
        snapshot?.syncState?.lastRemoteManifestHash ||
        "",
      lastUploadedAt: snapshot?.syncState?.lastUploadedAt || "",
      lastDownloadedAt: snapshot?.syncState?.lastDownloadedAt || "",
      lastRemotePath:
        remoteResult.remotePaths?.latestArchivePath ||
        snapshot?.syncState?.lastRemotePath ||
        "",
      syncStatus,
      lastError: "",
    });

    return {
      reconciled: false,
      action: "noop",
      reason: plan.reason,
      syncState: state,
    };
  };

  const getCloudLibraryCatalog = async (options = {}) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();
    if (!authState.user?.id) {
      throw new Error("Cloud library access requires a signed-in Supabase user.");
    }

    const localEntries = await listLocalLibraryEntries();
    const remoteResult = await fetchRemoteLibraryCatalog({
      bundle,
      authUserId: authState.user.id,
    });
    const catalogSnapshot = buildCloudLibraryCatalogSnapshot(
      localEntries,
      remoteResult.manifest.entries || [],
      options,
    );

    return {
      ...catalogSnapshot,
      remoteExists: remoteResult.exists,
      lastUpdatedAt: remoteResult.manifest.updatedAt || "",
    };
  };

  const syncLibraryCatalog = async (options = {}) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();
    if (!authState.user?.id) {
      throw new Error("Cloud library sync requires a signed-in Supabase user.");
    }

    const localEntries = await listLocalLibraryEntries();
    const remoteResult = await fetchRemoteLibraryCatalog({
      bundle,
      authUserId: authState.user.id,
    });
    const currentRemoteEntries = remoteResult.manifest.entries || [];
    const catalogSnapshot = buildCloudLibraryCatalogSnapshot(
      localEntries,
      currentRemoteEntries,
      options,
    );
    const currentSerialized = JSON.stringify(currentRemoteEntries);
    const nextSerialized = JSON.stringify(catalogSnapshot.mergedEntries);
    let manifest = remoteResult.manifest;

    if (!remoteResult.exists || currentSerialized !== nextSerialized) {
      const uploadResult = await uploadCloudLibraryCatalog({
        bundle,
        authUserId: authState.user.id,
        entries: catalogSnapshot.mergedEntries,
      });
      manifest = uploadResult.manifest;
    }

    return {
      ...catalogSnapshot,
      lastUpdatedAt: manifest.updatedAt || "",
    };
  };

  const removeLibraryCatalogEntries = async ({ targets = [] } = {}) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();
    if (!authState.user?.id) {
      throw new Error("Cloud library removal requires a signed-in Supabase user.");
    }

    const normalizedTargets = normalizeCloudLibraryDeleteTargets(targets);
    if (normalizedTargets.length === 0) {
      return {
        processedTargets: [],
        removedCount: 0,
        removedIdentityKeys: [],
        localEntries: await listLocalLibraryEntries(),
        remoteEntries: [],
        mergedEntries: [],
        remoteOnlyEntries: [],
        lastUpdatedAt: "",
      };
    }

    const localEntries = await listLocalLibraryEntries();
    const remoteResult = await fetchRemoteLibraryCatalog({
      bundle,
      authUserId: authState.user.id,
    });
    const remoteEntries = Array.isArray(remoteResult.manifest.entries)
      ? remoteResult.manifest.entries
      : [];
    const shouldRemoveEntry = (entry) =>
      normalizedTargets.some((target) => shouldRemoveCloudLibraryEntry(entry, target));
    const removedEntries = remoteEntries.filter(shouldRemoveEntry);
    const filteredRemoteEntries = remoteEntries.filter(
      (entry) => !shouldRemoveEntry(entry),
    );
    const filteredLocalEntries = localEntries.filter(
      (entry) => !shouldRemoveEntry(entry),
    );
    const catalogSnapshot = buildCloudLibraryCatalogSnapshot(
      filteredLocalEntries,
      filteredRemoteEntries,
    );
    const nextEntries = catalogSnapshot.mergedEntries;
    const currentSerialized = JSON.stringify(remoteEntries);
    const nextSerialized = JSON.stringify(nextEntries);
    let manifest = remoteResult.manifest;

    if (!remoteResult.exists || currentSerialized !== nextSerialized) {
      const uploadResult = await uploadCloudLibraryCatalog({
        bundle,
        authUserId: authState.user.id,
        entries: nextEntries,
      });
      manifest = uploadResult.manifest;
    }

    return {
      processedTargets: normalizedTargets,
      removedCount: removedEntries.length,
      removedIdentityKeys: normalizeCloudLibraryIdentityKeys(
        removedEntries.map((entry) => entry?.identityKey),
      ),
      localEntries: catalogSnapshot.localEntries,
      remoteEntries,
      mergedEntries: nextEntries,
      remoteOnlyEntries: getRemoteOnlyCloudLibraryEntries(
        nextEntries,
        catalogSnapshot.localEntries,
      ),
      lastUpdatedAt: manifest.updatedAt || "",
    };
  };

  const removeLibraryCatalogEntry = async (options = {}) => {
    const game = options?.game || null;
    const target = game
      ? buildCloudLibraryCatalogEntry(game) || {
          preferredIdentityKey: "",
          candidateIdentityKeys: buildCloudLibraryEntryIdentityCandidates({
            atlasId: game?.atlas_id || "",
            f95Id: game?.f95_id || "",
            siteUrl: game?.siteUrl || "",
            title: game?.displayTitle || game?.title || "",
            creator: game?.displayCreator || game?.creator || "",
          }),
          atlasId: String(game?.atlas_id || "").trim(),
          f95Id: String(game?.f95_id || "").trim(),
          siteUrl: String(game?.siteUrl || "").trim(),
          title: String(game?.displayTitle || game?.title || "").trim(),
          creator: String(game?.displayCreator || game?.creator || "").trim(),
        }
      : options?.target || null;

    return removeLibraryCatalogEntries({
      targets: target ? [target] : [],
    });
  };

  const onAuthStateChange = (listener) => {
    authListeners.add(listener);
    return () => {
      authListeners.delete(listener);
    };
  };

  return {
    getAuthState,
    onAuthStateChange,
    signInWithPassword,
    signOut,
    signUpWithPassword,
    reconcileGameSaves,
    uploadGameSaves,
    restoreGameSaves,
    getCloudLibraryCatalog,
    removeLibraryCatalogEntries,
    removeLibraryCatalogEntry,
    syncLibraryCatalog,
  };
}

module.exports = {
  buildCloudLibraryCatalogSnapshot,
  createCloudSaveService,
  filterCloudLibraryEntriesByIdentity,
  normalizeCloudLibraryIdentityKeys,
  normalizeCloudLibraryDeleteTarget,
  normalizeCloudLibraryDeleteTargets,
  shouldRemoveCloudLibraryEntry,
};
