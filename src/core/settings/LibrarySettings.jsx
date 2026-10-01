const librarySettingsErrorText = (result, fallback) =>
  (typeof result?.error === "string" && result.error) ||
  result?.error?.message ||
  fallback;

const ScanFolderRow = ({ source, onToggle, onReplace, onRemove, busy }) => {
  const [insight, setInsight] = React.useState(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    window.electronAPI
      .inspectFolder(source.path, { purpose: "scan" })
      .then((result) => alive && setInsight(result))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source.path]);

  const isMissing = insight?.status === "error";

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <window.ToggleSwitch
        checked={Boolean(source.isEnabled)}
        onChange={() => onToggle(source)}
        disabled={busy}
        label={
          source.isEnabled ? "Stop scanning this folder" : "Scan this folder"
        }
      />
      <div className="min-w-[220px] flex-1">
        <div
          className={`break-all font-mono text-[13px] ${
            source.isEnabled ? "text-text" : "text-text/45"
          }`}
        >
          {source.path}
        </div>
        <div className="mt-0.5 text-[11px] text-text/50">
          {isMissing ? (
            <span className="text-red-200">{insight.warnings[0].message}</span>
          ) : source.isEnabled ? (
            "Included in library scans"
          ) : (
            "Paused: skipped during scans"
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {confirmRemove ? (
          <>
            <span className="text-xs text-text/70">Stop scanning it?</span>
            <window.SettingsButton
              variant="danger"
              busy={busy}
              onClick={() => onRemove(source)}
            >
              Remove
            </window.SettingsButton>
            <window.SettingsButton
              variant="ghost"
              onClick={() => setConfirmRemove(false)}
            >
              Keep
            </window.SettingsButton>
          </>
        ) : (
          <>
            {!isMissing && (
              <window.SettingsButton
                icon="open_in_new"
                variant="ghost"
                onClick={() => window.electronAPI.openDirectory(source.path)}
              >
                Open
              </window.SettingsButton>
            )}
            <window.SettingsButton
              icon={isMissing ? "search" : "edit"}
              variant={isMissing ? "primary" : "ghost"}
              onClick={() => onReplace(source)}
            >
              {isMissing ? "Locate..." : "Change"}
            </window.SettingsButton>
            <window.SettingsButton
              icon="delete"
              variant="ghost"
              title="Remove from scan folders. Nothing is deleted from disk."
              onClick={() => setConfirmRemove(true)}
            />
          </>
        )}
      </div>
    </div>
  );
};

const ScanFoldersCard = ({ onScanNow, isScanRunning, markSaved }) => {
  const [sources, setSources] = React.useState(null);
  const [detected, setDetected] = React.useState(null);
  const [busyKey, setBusyKey] = React.useState("");
  const [error, setError] = React.useState("");
  const [hasNewFolders, setHasNewFolders] = React.useState(false);

  const loadSources = React.useCallback(async () => {
    const result = await window.electronAPI.getScanSources();
    if (!result?.success) {
      setError(librarySettingsErrorText(result, "Couldn't load scan folders."));
      setSources([]);
      return [];
    }
    setSources(result.sources || []);
    return result.sources || [];
  }, []);

  const detectFolders = React.useCallback(async () => {
    setDetected(null);
    const folders = await window.electronAPI
      .detectGameFolders()
      .catch(() => []);
    setDetected(Array.isArray(folders) ? folders : []);
  }, []);

  React.useEffect(() => {
    loadSources();
    detectFolders();
  }, [loadSources, detectFolders]);

  const run = async (key, action) => {
    setBusyKey(key);
    setError("");
    try {
      const result = await action();
      if (result && result.success === false) {
        setError(librarySettingsErrorText(result, "That didn't work."));
        return false;
      }
      markSaved?.();
      return true;
    } catch (actionError) {
      setError(actionError?.message || "That didn't work.");
      return false;
    } finally {
      setBusyKey("");
    }
  };

  const addFolder = async (folderPath) => {
    const added = await run(`add:${folderPath}`, () =>
      window.electronAPI.addScanSource(folderPath),
    );
    if (added) {
      setHasNewFolders(true);
      await loadSources();
      setDetected((previous) =>
        (previous || []).map((folder) =>
          folder.path === folderPath
            ? { ...folder, alreadyAdded: true }
            : folder,
        ),
      );
    }
  };

  const chooseAndAddFolder = async () => {
    const picked = await window.electronAPI.selectDirectory({
      title: "Choose a folder that contains games",
      buttonLabel: "Scan this folder",
    });
    if (picked) {
      await addFolder(picked);
    }
  };

  const toggleSource = (source) =>
    run(`toggle:${source.id}`, async () => {
      const result = await window.electronAPI.updateScanSource({
        id: source.id,
        isEnabled: !source.isEnabled,
      });
      if (result?.success) {
        setSources((previous) =>
          previous.map((item) =>
            item.id === source.id ? result.source : item,
          ),
        );
      }
      return result;
    });

  const replaceSource = async (source) => {
    const picked = await window.electronAPI.selectDirectory({
      title: "Choose the new location of this folder",
      defaultPath: source.path,
    });
    if (!picked) {
      return;
    }
    await run(`replace:${source.id}`, async () => {
      const result = await window.electronAPI.updateScanSource({
        id: source.id,
        path: picked,
      });
      if (result?.success) {
        setSources((previous) =>
          previous.map((item) =>
            item.id === source.id ? result.source : item,
          ),
        );
        setHasNewFolders(true);
      }
      return result;
    });
  };

  const removeSource = (source) =>
    run(`remove:${source.id}`, async () => {
      const result = await window.electronAPI.removeScanSource(source.id);
      if (result?.success) {
        setSources((previous) =>
          previous.filter((item) => item.id !== source.id),
        );
        setDetected((previous) =>
          (previous || []).map((folder) =>
            folder.path === source.path
              ? { ...folder, alreadyAdded: false }
              : folder,
          ),
        );
      }
      return result;
    });

  const newSuggestions = (detected || []).filter(
    (folder) => !folder.alreadyAdded,
  );
  const addAllSuggestions = async () => {
    for (const folder of newSuggestions) {
      await addFolder(folder.path);
    }
  };

  const scanNow = () => {
    setHasNewFolders(false);
    onScanNow?.();
  };

  return (
    <window.SettingsCard
      icon="travel_explore"
      title="Folders with games you already have"
      description="F95Launcher looks inside these folders and adds the games it finds to your library. Nothing is moved or deleted."
      actions={
        <>
          <window.SettingsButton
            icon="create_new_folder"
            onClick={chooseAndAddFolder}
          >
            Add folder...
          </window.SettingsButton>
          {onScanNow && (
            <window.SettingsButton
              icon="radar"
              variant="primary"
              busy={isScanRunning}
              disabled={!sources || sources.length === 0}
              onClick={scanNow}
            >
              {isScanRunning ? "Scanning..." : "Scan now"}
            </window.SettingsButton>
          )}
        </>
      }
    >
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 px-5 py-3 text-xs text-red-100">
          <span className="material-symbols-outlined text-[16px] leading-none">
            error
          </span>
          {error}
        </div>
      )}

      {hasNewFolders && onScanNow && !isScanRunning && (
        <div className="flex flex-wrap items-center gap-3 bg-accent/10 px-5 py-3 text-sm text-text">
          <span className="material-symbols-outlined text-[20px] leading-none text-accent">
            tips_and_updates
          </span>
          <span className="flex-1">
            Scan now to add the games from the new folders to your library.
          </span>
          <window.SettingsButton
            icon="radar"
            variant="primary"
            onClick={scanNow}
          >
            Scan now
          </window.SettingsButton>
        </div>
      )}

      {sources === null ? (
        <div className="px-5 py-4 text-xs text-text/55">Loading folders...</div>
      ) : sources.length === 0 ? (
        <div className="px-5 py-4 text-sm text-text/65">
          No folders yet. Add the folder where you keep downloaded games, or
          pick one that F95Launcher found below.
        </div>
      ) : (
        sources.map((source) => (
          <ScanFolderRow
            key={source.id}
            source={source}
            busy={busyKey.endsWith(`:${source.id}`)}
            onToggle={toggleSource}
            onReplace={replaceSource}
            onRemove={removeSource}
          />
        ))
      )}

      <div className="bg-black/10 px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="material-symbols-outlined text-[18px] leading-none text-glam">
            auto_awesome
          </span>
          <span className="flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-text/70">
            Found on this PC
          </span>
          {newSuggestions.length > 1 && (
            <window.SettingsButton
              icon="playlist_add"
              busy={busyKey.startsWith("add:")}
              onClick={addAllSuggestions}
            >
              Add all
            </window.SettingsButton>
          )}
          <window.SettingsButton
            icon="refresh"
            variant="ghost"
            busy={detected === null}
            onClick={detectFolders}
          >
            Look again
          </window.SettingsButton>
        </div>
        {detected === null ? (
          <div className="text-xs text-text/55">
            Looking in Downloads, Desktop and Games folders...
          </div>
        ) : newSuggestions.length === 0 ? (
          <div className="text-xs text-text/55">
            {detected.length > 0
              ? "All folders with games that F95Launcher found are already added."
              : "No games found in the usual places. Use Add folder to point to them."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {newSuggestions.map((folder) => (
              <div
                key={folder.path}
                className="flex flex-wrap items-center gap-3 border border-border/70 bg-black/15 px-3 py-2"
              >
                <span className="material-symbols-outlined text-[20px] leading-none text-text/60">
                  folder_special
                </span>
                <span className="min-w-[200px] flex-1 break-all font-mono text-[12px] text-text/85">
                  {folder.path}
                </span>
                <span className="text-xs text-emerald-200">
                  {folder.gameCount} {folder.gameCount === 1 ? "game" : "games"}
                </span>
                <window.SettingsButton
                  icon="add"
                  busy={busyKey === `add:${folder.path}`}
                  onClick={() => addFolder(folder.path)}
                >
                  Add
                </window.SettingsButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </window.SettingsCard>
  );
};

const ExtensionChipsEditor = ({
  label,
  description,
  value,
  defaultValue,
  onSave,
}) => {
  const [draft, setDraft] = React.useState("");
  const extensions = String(value || defaultValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const isDefault = extensions.join(",") === String(defaultValue || "");

  const commit = (nextExtensions) => onSave(nextExtensions.join(","));

  const addDraft = () => {
    const additions = draft
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().replace(/^\.+/, "").toLowerCase())
      .filter(
        (entry) =>
          /^[a-z0-9_]{1,12}$/.test(entry) && !extensions.includes(entry),
      );
    setDraft("");
    if (additions.length > 0) {
      commit([...extensions, ...additions]);
    }
  };

  return (
    <window.SettingRow title={label} description={description}>
      <div className="flex max-w-[420px] flex-wrap items-center justify-end gap-1.5">
        {extensions.map((extension) => (
          <span
            key={extension}
            className="inline-flex items-center gap-1 border border-border bg-black/25 py-0.5 pl-2 pr-1 font-mono text-[12px] text-text"
          >
            .{extension}
            <button
              type="button"
              aria-label={`Remove .${extension}`}
              disabled={extensions.length <= 1}
              onClick={() =>
                commit(extensions.filter((entry) => entry !== extension))
              }
              className="text-text/45 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-[14px] leading-none">
                close
              </span>
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addDraft();
            }
          }}
          onBlur={addDraft}
          placeholder="+ add"
          className="w-20 border border-border bg-black/25 px-2 py-0.5 font-mono text-[12px] text-text outline-none placeholder:text-text/35 focus:border-accent/60"
        />
        {!isDefault && (
          <window.SettingsButton
            variant="ghost"
            icon="restart_alt"
            onClick={() => onSave(defaultValue)}
          >
            Default
          </window.SettingsButton>
        )}
      </div>
    </window.SettingRow>
  );
};

const LIBRARY_BACKUPS_VISIBLE_DEFAULT = 5;

const libraryBackupDateText = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const libraryBackupGamesText = (count) =>
  typeof count === "number"
    ? `${count} ${count === 1 ? "game" : "games"}`
    : "Game count unknown";

const libraryBackupsConfirm = (options) =>
  window.AppUI?.confirm
    ? window.AppUI.confirm(options)
    : Promise.resolve(window.confirm(options.message));

/**
 * Library backups: snapshots of the library list that can be restored. One is
 * saved automatically before "Rebuild Library From Scratch".
 */
const LibraryBackupsCard = () => {
  const [backups, setBackups] = React.useState(null);
  const [busyKey, setBusyKey] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);

  const loadBackups = React.useCallback(async () => {
    try {
      const list = await window.electronAPI.listLibraryBackups();
      setBackups(Array.isArray(list) ? list : []);
    } catch (loadError) {
      console.error("[library.backups] Listing backups failed:", loadError);
      setBackups([]);
      setError("Couldn't load the list of backups.");
    }
  }, []);

  React.useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const backUpNow = async () => {
    setBusyKey("create");
    setError("");
    setNotice("");
    try {
      const result = await window.electronAPI.createLibraryBackup();
      if (!result?.success) {
        setError(
          librarySettingsErrorText(result, "The library could not be backed up."),
        );
        return;
      }
      setNotice("Backup saved.");
      await loadBackups();
    } catch (createError) {
      console.error("[library.backups] Backup failed:", createError);
      setError("The library could not be backed up.");
    } finally {
      setBusyKey("");
    }
  };

  const restoreBackup = async (backup) => {
    const confirmed = await libraryBackupsConfirm({
      title: "Restore this backup?",
      message:
        `Your current library is backed up first, then replaced with the library from ` +
        `${libraryBackupDateText(backup.createdAt)} (${libraryBackupGamesText(backup.gameCount).toLowerCase()}).\n\n` +
        "Game files and saves are not touched.",
      confirmLabel: "Restore",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setBusyKey(`restore:${backup.path}`);
    setError("");
    setNotice("");
    try {
      const result = await window.electronAPI.restoreLibraryBackup({
        backupPath: backup.path,
      });
      if (!result?.success) {
        setError(
          librarySettingsErrorText(result, "This backup could not be restored."),
        );
        return;
      }
      const restoredText = libraryBackupGamesText(Number(result.restoredGames) || 0);
      setNotice(
        `Library restored: ${restoredText}. Banners are downloaded again in the background.`,
      );
      window.AppUI?.toast?.success(`${restoredText} restored to your library.`, {
        title: "Library restored",
      });
      await loadBackups();
    } catch (restoreError) {
      console.error("[library.backups] Restore failed:", restoreError);
      setError("This backup could not be restored.");
    } finally {
      setBusyKey("");
    }
  };

  const visibleBackups = Array.isArray(backups)
    ? showAll
      ? backups
      : backups.slice(0, LIBRARY_BACKUPS_VISIBLE_DEFAULT)
    : [];
  const hiddenCount = Array.isArray(backups)
    ? backups.length - visibleBackups.length
    : 0;
  const formatBytes = window.settingsKit?.formatBytes || ((value) => `${value} B`);

  return (
    <window.SettingsCard
      icon="settings_backup_restore"
      title="Library backups"
      description="Snapshots of your library list: games, versions, favorites and links. One is saved automatically before the library is rebuilt. Game files and saves are not part of it."
      actions={
        <window.SettingsButton
          icon="backup"
          busy={busyKey === "create"}
          disabled={Boolean(busyKey)}
          onClick={backUpNow}
        >
          Back up now
        </window.SettingsButton>
      }
    >
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 px-5 py-3 text-xs text-red-100" role="alert">
          <span className="material-symbols-outlined text-[16px] leading-none">
            error
          </span>
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 bg-emerald-500/10 px-5 py-3 text-xs text-emerald-100" role="status">
          <span className="material-symbols-outlined text-[16px] leading-none">
            check_circle
          </span>
          {notice}
        </div>
      )}
      {backups === null ? (
        <div className="px-5 py-4 text-xs text-text/55">Loading backups...</div>
      ) : backups.length === 0 ? (
        <div className="px-5 py-4 text-sm text-text/65">
          No backups yet. Press Back up now to save one; a backup is also made
          automatically before the library is rebuilt from scratch.
        </div>
      ) : (
        <>
          {visibleBackups.map((backup) => (
            <div
              key={backup.path}
              className="flex flex-wrap items-center gap-3 px-5 py-3"
            >
              <span className="material-symbols-outlined text-[20px] leading-none text-text/60">
                inventory_2
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="text-sm text-text">
                  {libraryBackupDateText(backup.createdAt)}
                </div>
                <div className="mt-0.5 text-[11px] text-text/55">
                  {libraryBackupGamesText(backup.gameCount)} ·{" "}
                  {formatBytes(backup.sizeBytes)}
                </div>
              </div>
              <window.SettingsButton
                icon="settings_backup_restore"
                busy={busyKey === `restore:${backup.path}`}
                disabled={Boolean(busyKey)}
                onClick={() => restoreBackup(backup)}
              >
                Restore…
              </window.SettingsButton>
            </div>
          ))}
          {(hiddenCount > 0 || showAll) && backups.length > LIBRARY_BACKUPS_VISIBLE_DEFAULT && (
            <div className="px-5 py-2">
              <window.SettingsButton
                variant="ghost"
                icon={showAll ? "expand_less" : "expand_more"}
                onClick={() => setShowAll((previous) => !previous)}
              >
                {showAll ? "Show fewer" : `Show ${hiddenCount} older`}
              </window.SettingsButton>
            </div>
          )}
        </>
      )}
    </window.SettingsCard>
  );
};

const LibrarySettings = ({ settings, appInfo, onScanNow, isScanRunning }) => {
  const library = settings.config?.Library || {};
  const gameFolder = String(library.gameFolder || "").trim();
  const [suggestions, setSuggestions] = React.useState([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [showFileTypes, setShowFileTypes] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    window.electronAPI
      .suggestLibraryFolders()
      .then(
        (result) =>
          alive && setSuggestions(Array.isArray(result) ? result : []),
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gameFolder]);

  const saveGameFolder = async (folderPath) => {
    const result = await window.electronAPI.setDefaultGameFolder(folderPath);
    if (result?.success) {
      settings.markSaved();
      setShowSuggestions(false);
    }
    return result;
  };

  const otherSuggestions = suggestions.filter(
    (suggestion) => !suggestion.isCurrent,
  );
  const shouldShowSuggestions =
    otherSuggestions.length > 0 && (!gameFolder || showSuggestions);

  return (
    <div className="space-y-5">
      <window.SettingsCard
        icon="download_for_offline"
        title="Where new games are installed"
        description="Games you download from F95 are unpacked into this folder. Saves stay where each game keeps them."
        actions={
          gameFolder &&
          otherSuggestions.length > 0 && (
            <window.SettingsButton
              icon={showSuggestions ? "expand_less" : "lightbulb"}
              variant="ghost"
              onClick={() => setShowSuggestions((previous) => !previous)}
            >
              {showSuggestions ? "Hide suggestions" : "Suggest a location"}
            </window.SettingsButton>
          )
        }
      >
        <window.FolderPicker
          value={gameFolder}
          onSave={saveGameFolder}
          dialogTitle="Choose where F95Launcher installs games"
          emptyTitle="No games folder chosen yet"
          emptyDescription={
            appInfo?.paths?.fallbackGames
              ? `Until you pick one, games go to the app's data folder: ${appInfo.paths.fallbackGames}`
              : "Until you pick one, games go to the app's data folder."
          }
        />
        {shouldShowSuggestions && (
          <div className="px-5 py-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-text/55">
              {gameFolder ? "Other good places" : "One click to choose"}
            </div>
            <window.FolderSuggestionList
              suggestions={otherSuggestions}
              selectedPath={gameFolder}
              onSelect={(suggestion) => saveGameFolder(suggestion.path)}
            />
          </div>
        )}
      </window.SettingsCard>

      <ScanFoldersCard
        onScanNow={onScanNow}
        isScanRunning={isScanRunning}
        markSaved={settings.markSaved}
      />

      <LibraryBackupsCard />

      <window.SettingsCard
        icon="data_object"
        title="File types"
        description="Only change these if a game isn't detected or an archive isn't unpacked."
        actions={
          <window.SettingsButton
            icon={showFileTypes ? "expand_less" : "expand_more"}
            variant="ghost"
            onClick={() => setShowFileTypes((previous) => !previous)}
          >
            {showFileTypes ? "Hide" : "Show"}
          </window.SettingsButton>
        }
      >
        {showFileTypes && (
          <>
            <ExtensionChipsEditor
              label="Game launchers"
              description="Files that can start a game."
              value={library.gameExtensions}
              defaultValue={appInfo?.defaults?.gameExtensions}
              onSave={(next) =>
                settings.update("Library", { gameExtensions: next })
              }
            />
            <ExtensionChipsEditor
              label="Archives"
              description="Downloads that are unpacked automatically."
              value={library.extractionExtensions}
              defaultValue={appInfo?.defaults?.extractionExtensions}
              onSave={(next) =>
                settings.update("Library", { extractionExtensions: next })
              }
            />
          </>
        )}
      </window.SettingsCard>
    </div>
  );
};

window.LibrarySettings = LibrarySettings;
