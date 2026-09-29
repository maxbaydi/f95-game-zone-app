/**
 * "Save storage": the user's own cloud for saves. One connection at a time:
 * a folder synced by a desktop cloud client (zero credentials), a WebDAV
 * server, an S3 bucket or a bucket in the user's own Supabase project.
 * Everything here is optional; local saves, the vault and file export keep
 * working without it.
 *
 * Also exports SaveStorageQuickSetup, the trimmed version used by the first
 * launch assistant.
 */

const SAVE_STORAGE_TYPE_META = {
  folder: { icon: "cloud_sync", label: "Synced folder" },
  webdav: { icon: "dns", label: "WebDAV server" },
  s3: { icon: "database", label: "S3 bucket" },
  supabase: { icon: "deployed_code", label: "Supabase project" },
};

const saveStorageApi = () => window.electronAPI || {};

const saveStorageCall = async (method, ...args) => {
  const api = saveStorageApi();
  if (typeof api[method] !== "function") {
    throw new Error("This action needs a newer F95Launcher build.");
  }
  return api[method](...args);
};

const formatSaveStorageDate = (value) => {
  if (!value) {
    return "never";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
};

/** Live storage state shared by the settings page, the onboarding step and the game panel. */
const useSaveStorageState = () => {
  const [state, setState] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const result = await saveStorageCall("getSaveStorageState");
      setState(result?.state || null);
      return result?.state || null;
    } catch {
      setState(null);
      return null;
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    refresh();
    const unsubscribe = saveStorageApi().onSaveStorageChanged?.((next) => {
      if (alive && next) {
        setState(next);
      }
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [refresh]);

  return { state, refresh, setState };
};

const SaveStorageField = ({ label, hint, children }) => (
  <label className="block">
    <span className="text-xs font-medium text-text/85">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <span className="mt-1 block text-[11px] text-text/50">{hint}</span>}
  </label>
);

const SaveStorageInput = (props) => (
  <input
    {...props}
    className={`w-full border border-border bg-black/30 px-2.5 py-1.5 text-[13px] text-text outline-none transition focus:border-accent/60 ${props.className || ""}`}
  />
);

/**
 * Passphrase choice for a new storage. Off by default: most users want the
 * simplest path, the toggle explains what they get.
 */
const SaveStoragePassphraseChoice = ({ value, onChange, enabled, onToggle }) => (
  <div className="border border-border/70 bg-black/15 px-4 py-3">
    <div className="flex flex-wrap items-center gap-3">
      <window.ToggleSwitch
        label="Protect saves with a passphrase"
        checked={enabled}
        onChange={onToggle}
      />
      <div className="min-w-[200px] flex-1">
        <div className="text-sm font-medium text-text">Protect saves with a passphrase</div>
        <div className="text-xs text-text/55">
          Encrypts every backup before it leaves this PC. You will need the same
          passphrase on every other PC; there is no way to recover it.
        </div>
      </div>
    </div>
    {enabled && (
      <div className="mt-3 max-w-sm">
        <SaveStorageInput
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Passphrase"
          autoComplete="new-password"
        />
      </div>
    )}
  </div>
);

const DetectedCloudFolderCard = ({ folder, busy, onUse }) => (
  <button
    type="button"
    disabled={busy}
    onClick={() => onUse(folder)}
    className="group flex flex-col items-start gap-1.5 border border-border bg-black/15 px-4 py-3 text-left transition hover:border-accent/50 hover:bg-white/5 disabled:opacity-60"
  >
    <div className="flex w-full items-center gap-2">
      <span className="material-symbols-outlined text-[22px] leading-none text-accent">cloud_done</span>
      <span className="flex-1 text-sm font-semibold text-text">{folder.label}</span>
      {folder.recommended && (
        <span className="border border-glam/50 bg-glam/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-glam">
          One click
        </span>
      )}
    </div>
    <div className="break-all font-mono text-[12px] text-text/80">{folder.suggestedPath}</div>
    <div className="text-[11px] text-text/55">{folder.reason}</div>
    <span className="mt-1 text-[11px] text-accent opacity-0 transition group-hover:opacity-100">
      Use this cloud
    </span>
  </button>
);

/**
 * Choosing a storage. `compact` hides the advanced backends (onboarding).
 * Reports through onConnected(result) and onError(message).
 */
const SaveStorageChooser = ({ compact = false, onConnected, onError, onBusyChange }) => {
  const [folders, setFolders] = React.useState(null);
  const [mode, setMode] = React.useState("pick");
  const [busy, setBusy] = React.useState("");
  const [encrypt, setEncrypt] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const [pendingPayload, setPendingPayload] = React.useState(null);
  const [unlockPassphrase, setUnlockPassphrase] = React.useState("");
  const [cardPassphrase, setCardPassphrase] = React.useState("");
  const [cardFilePath, setCardFilePath] = React.useState("");
  const [webdav, setWebdav] = React.useState({ url: "", username: "", password: "" });
  const [s3, setS3] = React.useState({ endpoint: "", region: "auto", bucket: "", prefix: "f95launcher-saves", accessKeyId: "", secretAccessKey: "" });
  const [supabase, setSupabase] = React.useState({ url: "", key: "", bucket: "f95launcher-saves", prefix: "" });
  const [testResult, setTestResult] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    saveStorageCall("detectSaveStorageFolders")
      .then((result) => alive && setFolders(Array.isArray(result?.folders) ? result.folders : []))
      .catch(() => alive && setFolders([]));
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    onBusyChange?.(Boolean(busy));
  }, [busy, onBusyChange]);

  const connect = async (payload, busyKey) => {
    setBusy(busyKey);
    setTestResult(null);
    onError?.("");
    try {
      const result = await saveStorageCall("connectSaveStorage", payload);
      if (result?.needsPassphrase) {
        setPendingPayload(payload);
        setMode("unlock");
        return;
      }
      if (!result?.success) {
        onError?.(result?.error || "The storage could not be connected.");
        return;
      }
      setPendingPayload(null);
      onConnected?.(result);
    } catch (error) {
      onError?.(error?.message || String(error));
    } finally {
      setBusy("");
    }
  };

  const connectionPayload = (type, fields) => ({
    type,
    fields,
    passphrase: encrypt ? passphrase.trim() : "",
    encryptNew: encrypt && Boolean(passphrase.trim()),
  });

  const useDetected = (folder) =>
    connect(connectionPayload("folder", { folderPath: folder.suggestedPath, label: folder.label }), `folder:${folder.id}`);

  const chooseCustomFolder = async () => {
    const picked = await saveStorageApi().selectDirectory?.({
      title: "Choose a folder that your cloud keeps in sync",
      buttonLabel: "Use this folder",
    });
    if (picked) {
      await connect(connectionPayload("folder", { folderPath: picked, label: "" }), "folder:custom");
    }
  };

  const importCard = async () => {
    setBusy("card");
    onError?.("");
    try {
      const result = await saveStorageCall("importSaveStorageCard", {
        filePath: cardFilePath,
        cardPassphrase: cardPassphrase.trim(),
      });
      if (result?.cancelled) {
        return;
      }
      if (result?.needsCardPassphrase) {
        setCardFilePath(result.filePath || "");
        setMode("card-passphrase");
        if (result.code === "card_wrong_passphrase") {
          onError?.(result.error);
        }
        return;
      }
      if (!result?.success) {
        onError?.(result?.error || "The card could not be used.");
        return;
      }
      setCardFilePath("");
      setCardPassphrase("");
      onConnected?.(result);
    } catch (error) {
      onError?.(error?.message || String(error));
    } finally {
      setBusy("");
    }
  };

  const testRemote = async (type, fields) => {
    setBusy("test");
    setTestResult(null);
    onError?.("");
    try {
      const result = await saveStorageCall("testSaveStorageConnection", { type, fields });
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, error: error?.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  if (mode === "unlock") {
    return (
      <div className="space-y-3 border border-amber-400/35 bg-amber-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-text">
          <span className="material-symbols-outlined text-[20px] leading-none text-amber-200">key</span>
          This storage already holds encrypted saves
        </div>
        <p className="text-xs text-text/65">
          Enter the passphrase you chose when you set it up on the other PC. Nothing is changed until it matches.
        </p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            connect({ ...pendingPayload, passphrase: unlockPassphrase, encryptNew: false }, "unlock");
          }}
        >
          <div className="min-w-[220px] flex-1">
            <SaveStorageInput
              type="password"
              value={unlockPassphrase}
              onChange={(event) => setUnlockPassphrase(event.target.value)}
              placeholder="Passphrase"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <window.SettingsButton variant="primary" icon="lock_open" busy={busy === "unlock"} disabled={!unlockPassphrase.trim()} type="submit">
            Unlock and connect
          </window.SettingsButton>
          <window.SettingsButton variant="ghost" onClick={() => setMode("pick")} disabled={Boolean(busy)}>
            Back
          </window.SettingsButton>
        </form>
      </div>
    );
  }

  if (mode === "card-passphrase") {
    return (
      <div className="space-y-3 border border-amber-400/35 bg-amber-500/10 p-4">
        <div className="text-sm font-medium text-text">This connection card is sealed</div>
        <p className="text-xs text-text/65">Enter the passphrase that was used when the card was exported.</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            importCard();
          }}
        >
          <div className="min-w-[220px] flex-1">
            <SaveStorageInput
              type="password"
              value={cardPassphrase}
              onChange={(event) => setCardPassphrase(event.target.value)}
              placeholder="Card passphrase"
              autoFocus
            />
          </div>
          <window.SettingsButton variant="primary" icon="lock_open" busy={busy === "card"} disabled={!cardPassphrase.trim()} type="submit">
            Open card
          </window.SettingsButton>
          <window.SettingsButton variant="ghost" onClick={() => { setMode("pick"); setCardFilePath(""); }} disabled={Boolean(busy)}>
            Back
          </window.SettingsButton>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {folders === null ? (
        <div className="flex items-center gap-2 border border-border bg-black/15 px-4 py-4 text-sm text-text/70">
          <span className="material-symbols-outlined animate-spin text-[20px] leading-none text-accent">progress_activity</span>
          Looking for cloud clients on this PC...
        </div>
      ) : folders.length > 0 ? (
        <div>
          <div className="mb-2 text-xs text-text/60">
            These clouds are already set up on this PC. Pick one and F95Launcher keeps a folder in it up to date; the cloud client uploads it.
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {folders.map((folder) => (
              <DetectedCloudFolderCard key={`${folder.id}:${folder.path}`} folder={folder} busy={Boolean(busy)} onUse={useDetected} />
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-border bg-black/15 px-4 py-3 text-xs text-text/65">
          No cloud client (OneDrive, Dropbox, Google Drive, Yandex.Disk ...) was found on this PC. Pick any folder a cloud keeps in sync, or connect a server below.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <window.SettingsButton icon="drive_folder_upload" busy={busy === "folder:custom"} disabled={Boolean(busy)} onClick={chooseCustomFolder}>
          Choose another folder...
        </window.SettingsButton>
        <window.SettingsButton icon="badge" busy={busy === "card"} disabled={Boolean(busy)} onClick={importCard}>
          I have a connection card...
        </window.SettingsButton>
        {!compact && (
          <>
            <window.SettingsButton icon="dns" variant={mode === "webdav" ? "primary" : "secondary"} disabled={Boolean(busy)} onClick={() => setMode(mode === "webdav" ? "pick" : "webdav")}>
              WebDAV server
            </window.SettingsButton>
            <window.SettingsButton icon="database" variant={mode === "s3" ? "primary" : "secondary"} disabled={Boolean(busy)} onClick={() => setMode(mode === "s3" ? "pick" : "s3")}>
              S3 bucket
            </window.SettingsButton>
            <window.SettingsButton icon="deployed_code" variant={mode === "supabase" ? "primary" : "secondary"} disabled={Boolean(busy)} onClick={() => setMode(mode === "supabase" ? "pick" : "supabase")}>
              Supabase project
            </window.SettingsButton>
          </>
        )}
      </div>

      {mode === "webdav" && (
        <form
          className="space-y-3 border border-border bg-black/15 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            connect(connectionPayload("webdav", webdav), "webdav");
          }}
        >
          <div className="text-sm font-medium text-text">WebDAV server</div>
          <div className="text-xs text-text/55">
            Works with Nextcloud, ownCloud, Yandex.Disk (https://webdav.yandex.ru), Box, pCloud, Koofr and most NAS devices. Use an app password where your provider offers one.
          </div>
          <SaveStorageField label="Address">
            <SaveStorageInput value={webdav.url} onChange={(event) => setWebdav({ ...webdav, url: event.target.value })} placeholder="https://cloud.example.com/remote.php/dav/files/you/" />
          </SaveStorageField>
          <div className="grid gap-3 sm:grid-cols-2">
            <SaveStorageField label="Username">
              <SaveStorageInput value={webdav.username} onChange={(event) => setWebdav({ ...webdav, username: event.target.value })} autoComplete="username" />
            </SaveStorageField>
            <SaveStorageField label="Password or app password">
              <SaveStorageInput type="password" value={webdav.password} onChange={(event) => setWebdav({ ...webdav, password: event.target.value })} autoComplete="current-password" />
            </SaveStorageField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <window.SettingsButton icon="network_check" busy={busy === "test"} disabled={Boolean(busy) || !webdav.url} onClick={() => testRemote("webdav", webdav)}>
              Test connection
            </window.SettingsButton>
            <window.SettingsButton variant="primary" icon="link" busy={busy === "webdav"} disabled={Boolean(busy) || !webdav.url} type="submit">
              Connect
            </window.SettingsButton>
          </div>
        </form>
      )}

      {mode === "s3" && (
        <form
          className="space-y-3 border border-border bg-black/15 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            connect(connectionPayload("s3", s3), "s3");
          }}
        >
          <div className="text-sm font-medium text-text">S3-compatible bucket</div>
          <div className="text-xs text-text/55">Backblaze B2, Cloudflare R2, Wasabi, MinIO, AWS S3. Create a bucket and an access key with read/write rights on it.</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SaveStorageField label="Endpoint" hint="e.g. https://s3.us-west-004.backblazeb2.com or https://<account>.r2.cloudflarestorage.com">
              <SaveStorageInput value={s3.endpoint} onChange={(event) => setS3({ ...s3, endpoint: event.target.value })} placeholder="https://..." />
            </SaveStorageField>
            <SaveStorageField label="Bucket">
              <SaveStorageInput value={s3.bucket} onChange={(event) => setS3({ ...s3, bucket: event.target.value })} />
            </SaveStorageField>
            <SaveStorageField label="Region" hint="auto works for R2 and B2">
              <SaveStorageInput value={s3.region} onChange={(event) => setS3({ ...s3, region: event.target.value })} />
            </SaveStorageField>
            <SaveStorageField label="Folder inside the bucket">
              <SaveStorageInput value={s3.prefix} onChange={(event) => setS3({ ...s3, prefix: event.target.value })} />
            </SaveStorageField>
            <SaveStorageField label="Access key ID">
              <SaveStorageInput value={s3.accessKeyId} onChange={(event) => setS3({ ...s3, accessKeyId: event.target.value })} autoComplete="off" />
            </SaveStorageField>
            <SaveStorageField label="Secret access key">
              <SaveStorageInput type="password" value={s3.secretAccessKey} onChange={(event) => setS3({ ...s3, secretAccessKey: event.target.value })} autoComplete="off" />
            </SaveStorageField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <window.SettingsButton icon="network_check" busy={busy === "test"} disabled={Boolean(busy)} onClick={() => testRemote("s3", s3)}>
              Test connection
            </window.SettingsButton>
            <window.SettingsButton variant="primary" icon="link" busy={busy === "s3"} disabled={Boolean(busy)} type="submit">
              Connect
            </window.SettingsButton>
          </div>
        </form>
      )}

      {mode === "supabase" && (
        <form
          className="space-y-3 border border-border bg-black/15 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            connect(connectionPayload("supabase", supabase), "supabase");
          }}
        >
          <div className="text-sm font-medium text-text">Your own Supabase project</div>
          <div className="text-xs text-text/55">
            A free project at supabase.com is enough. Open the project, go to Settings → API, and copy the project URL and the <span className="font-medium text-text/80">service_role</span> key (it stays on this PC, encrypted). The bucket is created for you on first use. Free projects pause after a week without traffic; the launcher wakes them up the next time it syncs.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SaveStorageField label="Project URL">
              <SaveStorageInput value={supabase.url} onChange={(event) => setSupabase({ ...supabase, url: event.target.value })} placeholder="https://xxxxxxxx.supabase.co" />
            </SaveStorageField>
            <SaveStorageField label="API key" hint="service_role for a private project, or a publishable key with storage policies">
              <SaveStorageInput type="password" value={supabase.key} onChange={(event) => setSupabase({ ...supabase, key: event.target.value })} autoComplete="off" />
            </SaveStorageField>
            <SaveStorageField label="Bucket">
              <SaveStorageInput value={supabase.bucket} onChange={(event) => setSupabase({ ...supabase, bucket: event.target.value })} placeholder="f95launcher-saves" />
            </SaveStorageField>
            <SaveStorageField label="Folder inside the bucket" hint="optional">
              <SaveStorageInput value={supabase.prefix} onChange={(event) => setSupabase({ ...supabase, prefix: event.target.value })} />
            </SaveStorageField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <window.SettingsButton icon="network_check" busy={busy === "test"} disabled={Boolean(busy) || !supabase.url || !supabase.key} onClick={() => testRemote("supabase", supabase)}>
              Test connection
            </window.SettingsButton>
            <window.SettingsButton variant="primary" icon="link" busy={busy === "supabase"} disabled={Boolean(busy) || !supabase.url || !supabase.key} type="submit">
              Connect
            </window.SettingsButton>
          </div>
        </form>
      )}

      {testResult && (
        <div className={`border px-3 py-2 text-xs ${testResult.success ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : "border-red-500/40 bg-red-500/10 text-red-100"}`}>
          {testResult.success
            ? `${testResult.message}${testResult.existing ? ` Saves from ${testResult.createdBy || "another PC"} were found here${testResult.encrypted ? " (encrypted)" : ""}.` : " No saves yet: this will be a fresh storage."}`
            : testResult.error}
        </div>
      )}

      <SaveStoragePassphraseChoice value={passphrase} onChange={setPassphrase} enabled={encrypt} onToggle={setEncrypt} />
    </div>
  );
};

const SaveStorageCatalog = ({ state }) => {
  const [catalog, setCatalog] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const result = await saveStorageCall("getSaveStorageCatalog");
      setCatalog(result?.success ? result.entries || [] : []);
    } catch {
      setCatalog([]);
    }
  }, []);

  React.useEffect(() => {
    if (state?.connected && !state?.locked) {
      load();
    } else {
      setCatalog(null);
    }
  }, [state?.connected, state?.locked, state?.lastSyncAt, load]);

  if (!state?.connected || state?.locked) {
    return null;
  }

  const restore = async (entry) => {
    setBusy(`restore:${entry.identity}`);
    setMessage("");
    try {
      const result = await saveStorageCall("syncSaveStorageGame", entry.recordId, "restore");
      setMessage(result?.success ? `${entry.title}: ${result.result?.importedFiles || 0} file(s) restored.` : result?.error || "Restore failed.");
    } catch (error) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy("");
    }
  };

  return (
    <window.SettingsCard
      icon="inventory_2"
      title="Backups in this storage"
      description="Every game that has a backup here, from any PC. Games that are in your library can be restored right away; the others come back the moment you install them."
      actions={
        <window.SettingsButton icon="refresh" onClick={load}>
          Refresh
        </window.SettingsButton>
      }
    >
      {catalog === null ? (
        <div className="px-5 py-4 text-sm text-text/60">Reading the storage...</div>
      ) : catalog.length === 0 ? (
        <div className="px-5 py-4 text-sm text-text/60">No backups yet. They appear after the first sync.</div>
      ) : (
        catalog.map((entry) => (
          <div key={entry.identity} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className={`material-symbols-outlined text-[20px] leading-none ${entry.inLibrary ? "text-emerald-300" : "text-text/40"}`}>
              {entry.inLibrary ? "check_circle" : "cloud"}
            </span>
            <div className="min-w-[220px] flex-1">
              <div className="text-sm font-medium text-text">{entry.title || entry.identity}</div>
              <div className="text-[11px] text-text/55">
                {entry.creator ? `${entry.creator} · ` : ""}
                {entry.fileCount || 0} file(s) · updated {formatSaveStorageDate(entry.updatedAt)}
                {entry.device ? ` from ${entry.device}` : ""}
                {entry.inLibrary ? (entry.installed ? " · in your library" : " · in your library, not installed") : " · not in this library yet"}
              </div>
            </div>
            {entry.inLibrary && entry.installed && (
              <window.SettingsButton icon="cloud_download" busy={busy === `restore:${entry.identity}`} disabled={Boolean(busy)} onClick={() => restore(entry)}>
                Restore
              </window.SettingsButton>
            )}
          </div>
        ))
      )}
      {message && <div className="px-5 py-3 text-xs text-text/80">{message}</div>}
    </window.SettingsCard>
  );
};

const SaveStorageSettings = () => {
  const { state, refresh } = useSaveStorageState();
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [unlockPassphrase, setUnlockPassphrase] = React.useState("");
  const [cardPassphrase, setCardPassphrase] = React.useState("");
  const [showCardExport, setShowCardExport] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [progress, setProgress] = React.useState(null);

  React.useEffect(() => {
    const unsubscribe = saveStorageApi().onSaveStorageProgress?.((payload) => setProgress(payload));
    return () => unsubscribe?.();
  }, []);

  const run = async (key, action, successText) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (result?.cancelled) {
        return;
      }
      if (!result?.success) {
        setError(result?.error || "The action failed.");
        return;
      }
      setNotice(typeof successText === "function" ? successText(result) : successText);
      await refresh();
    } catch (actionError) {
      setError(actionError?.message || String(actionError));
    } finally {
      setBusy("");
    }
  };

  const typeMeta = SAVE_STORAGE_TYPE_META[state?.type] || SAVE_STORAGE_TYPE_META.folder;

  return (
    <div className="space-y-5">
      {state?.connected ? (
        <window.SettingsCard
          icon={typeMeta.icon}
          title={`Connected: ${state.label || typeMeta.label}`}
          description={state.description}
          actions={
            !state.locked && (
              <window.SettingsButton
                variant="primary"
                icon="sync"
                busy={busy === "sync" || state.busy}
                onClick={() => run("sync", () => saveStorageCall("syncSaveStorageAll", "sync"), (result) => {
                  const summary = result.summary || {};
                  return `Sync finished: ${summary.uploaded || 0} backed up, ${summary.restored || 0} restored, ${summary.synced || 0} already up to date${summary.conflicts ? `, ${summary.conflicts} need a decision` : ""}${summary.failed ? `, ${summary.failed} failed` : ""}.`;
                })}
              >
                Sync now
              </window.SettingsButton>
            )
          }
        >
          {state.locked ? (
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                <span className="material-symbols-outlined text-[20px] leading-none">lock</span>
                Locked: the passphrase is not stored on this PC
              </div>
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run("unlock", () => saveStorageCall("unlockSaveStorage", unlockPassphrase.trim()), "Storage unlocked. Syncing in the background.");
                }}
              >
                <div className="min-w-[220px] flex-1 max-w-sm">
                  <SaveStorageInput type="password" value={unlockPassphrase} onChange={(event) => setUnlockPassphrase(event.target.value)} placeholder="Passphrase" />
                </div>
                <window.SettingsButton variant="primary" icon="lock_open" busy={busy === "unlock"} disabled={!unlockPassphrase.trim()} type="submit">
                  Unlock
                </window.SettingsButton>
              </form>
            </div>
          ) : (
            <window.SettingRow
              title="Status"
              description={`Last sync: ${formatSaveStorageDate(state.lastSyncAt)}${state.encrypted ? " · backups are encrypted with your passphrase" : " · backups are stored as plain zip files"}${state.secretsEncrypted ? "" : " · credentials are stored without OS encryption on this PC"}`}
            >
              {state.lastError ? (
                <span className="max-w-xs text-xs text-red-200">{state.lastError}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-200">
                  <span className="material-symbols-outlined text-[16px] leading-none">check_circle</span>
                  {state.busy ? "Syncing..." : "Ready"}
                </span>
              )}
            </window.SettingRow>
          )}

          {progress?.active && (
            <div className="px-5 py-3 text-xs text-text/70">
              Syncing {progress.completed}/{progress.total}
              {progress.currentTitle ? ` · ${progress.currentTitle}` : ""}
            </div>
          )}

          <window.SettingRow
            title="Use this storage on another PC"
            description="Export a connection card, copy it to the other PC and open it there in Settings → Save storage. Seal it with a passphrase if it will travel over email or a chat."
          >
            <window.SettingsButton icon="badge" onClick={() => setShowCardExport((previous) => !previous)}>
              Export connection card...
            </window.SettingsButton>
          </window.SettingRow>
          {showCardExport && (
            <div className="px-5 py-3">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run("card", () => saveStorageCall("exportSaveStorageCard", cardPassphrase.trim()), (result) => `Card saved to ${result.filePath}${result.sealed ? " (sealed)" : " (not sealed: it contains your credentials)"}.`);
                }}
              >
                <div className="min-w-[220px] max-w-sm flex-1">
                  <SaveStorageInput type="password" value={cardPassphrase} onChange={(event) => setCardPassphrase(event.target.value)} placeholder="Card passphrase (optional)" />
                </div>
                <window.SettingsButton variant="primary" icon="download" busy={busy === "card"} type="submit">
                  Save card
                </window.SettingsButton>
              </form>
            </div>
          )}

          <window.SettingRow
            title="Disconnect"
            description="Stops syncing on this PC. Nothing in the storage is deleted, so you can reconnect any time."
          >
            {confirmDisconnect ? (
              <>
                <span className="text-xs text-text/70">Disconnect this PC?</span>
                <window.SettingsButton variant="danger" busy={busy === "disconnect"} onClick={() => run("disconnect", () => saveStorageCall("disconnectSaveStorage"), "Disconnected. Your saves stay in the storage.").then(() => setConfirmDisconnect(false))}>
                  Disconnect
                </window.SettingsButton>
                <window.SettingsButton variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                  Keep
                </window.SettingsButton>
              </>
            ) : (
              <window.SettingsButton icon="link_off" onClick={() => setConfirmDisconnect(true)}>
                Disconnect...
              </window.SettingsButton>
            )}
          </window.SettingRow>
        </window.SettingsCard>
      ) : (
        <window.SettingsCard
          icon="cloud_sync"
          title="Keep saves in your own cloud"
          description="Optional. F95Launcher backs up saves to a place you own and restores them on any PC where you connect the same place. No account with us, no servers of ours."
        >
          <div className="px-5 py-4">
            <SaveStorageChooser
              onError={setError}
              onConnected={(result) => {
                setError("");
                setNotice(
                  result?.existing
                    ? "Connected. Saves from your other PC were found; they are being matched with your library now."
                    : "Connected. Your saves will be backed up here from now on.",
                );
                refresh();
              }}
            />
          </div>
        </window.SettingsCard>
      )}

      {(error || notice) && (
        <div className={`border px-4 py-3 text-sm ${error ? "border-red-500/40 bg-red-500/10 text-red-100" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"}`}>
          {error || notice}
        </div>
      )}

      <SaveStorageCatalog state={state} />

      <window.SettingsCard
        icon="info"
        title="How it works"
        description="Every game's saves are packed into one zip with a manifest. After each install, after you play, and on every start the app compares your PC with the storage and copies the newer side. Before anything is overwritten the previous saves go to the local vault."
      >
        <window.SettingRow
          title="F95Launcher runs no servers"
          description="Your saves only ever go to the place you connected: a folder your cloud client syncs, your WebDAV server, your S3 bucket or your own Supabase project. Disconnecting leaves the files where they are."
        />
      </window.SettingsCard>
    </div>
  );
};

/** Onboarding step body: detected clouds, a folder picker, or "later". */
const SaveStorageQuickSetup = ({ onConnected }) => {
  const { state, refresh } = useSaveStorageState();
  const [error, setError] = React.useState("");

  if (state?.connected) {
    return (
      <div className="border border-emerald-400/40 bg-emerald-500/5 p-5">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[28px] leading-none text-emerald-300">check_circle</span>
          <div>
            <div className="text-base font-semibold text-text">Saves go to {state.label || "your storage"}</div>
            <div className="text-xs text-text/60">{state.description}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-text/60">
          Everything else is automatic. You can change or disconnect it later in Settings → Save storage.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SaveStorageChooser
        compact
        onError={setError}
        onConnected={(result) => {
          setError("");
          refresh();
          onConnected?.(result);
        }}
      />
      {error && (
        <div className="flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          <span className="material-symbols-outlined text-[16px] leading-none">error</span>
          {error}
        </div>
      )}
    </div>
  );
};

window.useSaveStorageState = useSaveStorageState;
window.SaveStorageSettings = SaveStorageSettings;
window.SaveStorageQuickSetup = SaveStorageQuickSetup;
