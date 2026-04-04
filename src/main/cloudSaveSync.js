const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { buildSaveManifest } = require("../shared/saveManifest");
const {
  createSupabaseDesktopClient,
  resolveSupabaseSettings,
} = require("./supabase/client");
const {
  backupGameSaves,
  resolveSaveProfileDestinationPath,
} = require("./saveVault");

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

async function walkFiles(rootPath, prefixPath = "") {
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
      ...(await walkFiles(path.join(rootPath, entry.name), nextRelativePath)),
    );
  }

  return collected;
}

function getArchiveRoot(profile, index) {
  const suffix =
    profile.strategy?.type === "renpy-appdata"
      ? `renpy-${profile.strategy?.payload?.folderName || index}`
      : `local-${index}`;
  return `profiles/${suffix}`;
}

async function buildCloudSaveArchive(appPaths, identity, profiles) {
  const zip = new AdmZip();
  const manifestProfiles = [];
  const manifestEntries = [];

  for (const [index, profile] of profiles.entries()) {
    const archiveRoot = getArchiveRoot(profile, index);
    const files = await walkFiles(profile.rootPath);

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

  const uploadGameSaves = async ({ recordId }) => {
    const bundle = await withConfiguredClient();
    const authState = await getAuthState();
    if (!authState.user?.id) {
      throw new Error("Cloud save upload requires a signed-in Supabase user.");
    }

    const snapshot = await getSaveProfileSnapshot(recordId);
    const game = snapshot?.game || null;
    const profiles = snapshot?.profiles || [];
    if (profiles.length === 0) {
      throw new Error("No local save profiles were detected for this game.");
    }

    const cloudIdentity = snapshot?.syncState?.cloudIdentity || "";
    if (!cloudIdentity) {
      throw new Error("No cloud identity is registered for this game.");
    }
    const { archivePath, manifest } = await buildCloudSaveArchive(
      appPaths,
      cloudIdentity,
      profiles,
    );
    const archiveBuffer = await fs.promises.readFile(archivePath);
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const remoteBase = `${authState.user.id}/${cloudIdentity}`;
    const latestArchivePath = `${remoteBase}/latest.zip`;
    const latestManifestPath = `${remoteBase}/latest.manifest.json`;
    const historyArchivePath = `${remoteBase}/history/${Date.now()}.zip`;

    try {
      const archiveUpload = await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .upload(latestArchivePath, archiveBuffer, {
          contentType: "application/zip",
          upsert: true,
        });
      if (archiveUpload.error) {
        throw archiveUpload.error;
      }

      const manifestUpload = await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .upload(latestManifestPath, manifestBuffer, {
          contentType: "application/json",
          upsert: true,
        });
      if (manifestUpload.error) {
        throw manifestUpload.error;
      }

      await bundle.client.storage
        .from(bundle.settings.storageBucket)
        .upload(historyArchivePath, archiveBuffer, {
          contentType: "application/zip",
          upsert: false,
        });

      const state = await upsertSaveSyncState({
        recordId,
        cloudIdentity,
        lastLocalManifestHash: manifest.manifestHash,
        lastRemoteManifestHash: manifest.manifestHash,
        lastUploadedAt: new Date().toISOString(),
        lastRemotePath: latestArchivePath,
        syncStatus: "uploaded",
        lastError: "",
      });

      return {
        uploaded: true,
        remotePath: latestArchivePath,
        manifestHash: manifest.manifestHash,
        game,
        syncState: state,
      };
    } catch (error) {
      await upsertSaveSyncState({
        recordId,
        cloudIdentity,
        lastLocalManifestHash: manifest.manifestHash,
        lastRemoteManifestHash: snapshot?.syncState?.lastRemoteManifestHash || "",
        lastUploadedAt: snapshot?.syncState?.lastUploadedAt || "",
        lastDownloadedAt: snapshot?.syncState?.lastDownloadedAt || "",
        lastRemotePath: snapshot?.syncState?.lastRemotePath || "",
        syncStatus: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await fs.promises.unlink(archivePath).catch(() => {});
    }
  };

  const restoreGameSaves = async ({ recordId }) => {
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

    const remoteArchivePath =
      syncState.lastRemotePath ||
      `${authState.user.id}/${syncState.cloudIdentity}/latest.zip`;
    const downloadResult = await bundle.client.storage
      .from(bundle.settings.storageBucket)
      .download(remoteArchivePath);
    if (downloadResult.error || !downloadResult.data) {
      throw downloadResult.error || new Error("Failed to download cloud save archive.");
    }

    const arrayBuffer = await downloadResult.data.arrayBuffer();
    const archivePath = createTempPath(appPaths, "cloud-restore.zip");
    const extractionPath = createTempPath(appPaths, "cloud-restore");
    const installDirectory =
      game?.versions?.find((version) => version.game_path)?.game_path || "";

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

    try {
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

      return {
        restored: true,
        game,
        manifestHash: manifest.manifestHash || "",
        syncState: state,
      };
    } catch (error) {
      await upsertSaveSyncState({
        recordId,
        cloudIdentity: syncState.cloudIdentity,
        lastLocalManifestHash: syncState.lastLocalManifestHash || "",
        lastRemoteManifestHash: syncState.lastRemoteManifestHash || "",
        lastUploadedAt: syncState.lastUploadedAt || "",
        lastDownloadedAt: syncState.lastDownloadedAt || "",
        lastRemotePath: remoteArchivePath,
        syncStatus: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await fs.promises
        .rm(extractionPath, { recursive: true, force: true })
        .catch(() => {});
      await fs.promises.unlink(archivePath).catch(() => {});
    }
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
    uploadGameSaves,
    restoreGameSaves,
  };
}

module.exports = {
  createCloudSaveService,
};
