const settingsKitFormatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

/**
 * Loads the app config once, keeps it in sync with other windows and saves
 * single settings instantly (optimistic, with a short "Saved" confirmation).
 */
const useAppSettings = () => {
  const [config, setConfig] = React.useState(null);
  const [saveState, setSaveState] = React.useState({ status: "idle" });
  const clearTimerRef = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    window.electronAPI
      .getConfig()
      .then((nextConfig) => alive && setConfig(nextConfig || {}))
      .catch((error) => {
        console.error("Failed to load settings:", error);
        if (alive) {
          setConfig({});
        }
      });

    const unsubscribe = window.electronAPI.onSettingsChanged?.(
      (nextConfig) => alive && nextConfig && setConfig(nextConfig),
    );

    return () => {
      alive = false;
      clearTimeout(clearTimerRef.current);
      unsubscribe?.();
    };
  }, []);

  const update = React.useCallback(async (section, values) => {
    setConfig((previous) => ({
      ...(previous || {}),
      [section]: { ...(previous?.[section] || {}), ...values },
    }));
    setSaveState({ status: "saving" });
    clearTimeout(clearTimerRef.current);

    try {
      const result = await window.electronAPI.updateSettings(section, values);
      if (!result?.success) {
        throw new Error(result?.error || "Couldn't save this setting.");
      }

      setConfig(result.config);
      setSaveState({ status: "saved" });
      clearTimerRef.current = setTimeout(
        () => setSaveState({ status: "idle" }),
        1800,
      );
      return result;
    } catch (error) {
      console.error("Failed to save setting:", error);
      setSaveState({ status: "error", message: error.message });
      window.electronAPI
        .getConfig()
        .then((nextConfig) => setConfig(nextConfig || {}))
        .catch(() => {});
      return { success: false, error: error.message };
    }
  }, []);

  const markSaved = React.useCallback(() => {
    clearTimeout(clearTimerRef.current);
    setSaveState({ status: "saved" });
    clearTimerRef.current = setTimeout(
      () => setSaveState({ status: "idle" }),
      1800,
    );
  }, []);

  return { config, update, saveState, markSaved };
};

const useAppInfo = () => {
  const [appInfo, setAppInfo] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    window.electronAPI
      .getAppInfo?.()
      .then((info) => alive && setAppInfo(info || null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return appInfo;
};

const useFolderInsight = (folderPath) => {
  const [state, setState] = React.useState({ loading: false, insight: null });
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    const normalizedPath = String(folderPath || "").trim();
    if (!normalizedPath) {
      setState({ loading: false, insight: null });
      return undefined;
    }

    let alive = true;
    setState((previous) => ({ ...previous, loading: true }));
    window.electronAPI
      .inspectFolder(normalizedPath)
      .then((insight) => alive && setState({ loading: false, insight }))
      .catch(() => alive && setState({ loading: false, insight: null }));

    return () => {
      alive = false;
    };
  }, [folderPath, revision]);

  const refresh = React.useCallback(
    () => setRevision((previous) => previous + 1),
    [],
  );

  return { ...state, refresh };
};

const SettingsSaveIndicator = ({ saveState }) => {
  if (!saveState || saveState.status === "idle") {
    return null;
  }

  const variants = {
    saving: {
      icon: "progress_activity",
      text: "Saving...",
      tone: "border-border bg-white/5 text-text/70",
      spin: true,
    },
    saved: {
      icon: "check_circle",
      text: "Saved",
      tone: "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
    },
    error: {
      icon: "error",
      text: saveState.message || "Couldn't save",
      tone: "border-red-500/40 bg-red-500/10 text-red-100",
    },
  };
  const variant = variants[saveState.status] || variants.saving;

  return (
    <div
      role="status"
      className={`flex items-center gap-1.5 border px-2.5 py-1 text-xs ${variant.tone}`}
    >
      <span
        className={`material-symbols-outlined text-[16px] leading-none ${
          variant.spin ? "animate-spin" : ""
        }`}
      >
        {variant.icon}
      </span>
      {variant.text}
    </div>
  );
};

const SettingsCard = ({ icon, title, description, actions, children }) => {
  const hasBody = React.Children.toArray(children).some(Boolean);
  return (
    <section className="border border-border bg-secondary/60 shadow-glass">
      {(title || actions) && (
        <header
          className={`flex flex-wrap items-start gap-3 px-5 py-4 ${
            hasBody ? "border-b border-border/70" : ""
          }`}
        >
          {icon && (
            <span className="material-symbols-outlined mt-0.5 text-[22px] leading-none text-accent">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-text">{title}</h3>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-text/60">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </header>
      )}
      {hasBody && <div className="divide-y divide-border/60">{children}</div>}
    </section>
  );
};

const SettingRow = ({ title, description, badge, children }) => (
  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
    <div className="min-w-[220px] flex-1">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
        {title}
        {badge}
      </div>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-text/55">
          {description}
        </p>
      )}
    </div>
    {children && (
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    )}
  </div>
);

const ToggleSwitch = ({ checked, onChange, disabled = false, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={Boolean(checked)}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange?.(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
      checked
        ? "border-accent/70 bg-accent/80"
        : "border-border bg-black/30 hover:bg-black/40"
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform shadow transition-transform ${
        checked
          ? "translate-x-[22px] bg-onAccent"
          : "translate-x-[3px] bg-text/80"
      }`}
    />
  </button>
);

const SettingsButton = ({
  children,
  icon,
  variant = "secondary",
  busy = false,
  className = "",
  ...props
}) => {
  const variants = {
    primary:
      "bg-accent text-onAccent font-semibold hover:brightness-110 border border-accent",
    secondary: "border border-border bg-white/5 text-text hover:bg-white/10",
    danger:
      "border border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20",
    ghost:
      "border border-transparent text-text/75 hover:bg-white/5 hover:text-text",
  };

  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {(icon || busy) && (
        <span
          className={`material-symbols-outlined text-[16px] leading-none ${
            busy ? "animate-spin" : ""
          }`}
        >
          {busy ? "progress_activity" : icon}
        </span>
      )}
      {children}
    </button>
  );
};

const RestartRequiredBadge = ({ onRestart }) => (
  <span className="inline-flex items-center gap-1.5 border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-normal text-amber-100">
    Takes effect after restart
    {onRestart && (
      <button
        type="button"
        onClick={onRestart}
        className="font-semibold underline decoration-dotted underline-offset-2 hover:text-white"
      >
        Restart now
      </button>
    )}
  </span>
);

const FolderSpaceBar = ({ freeBytes, totalBytes }) => {
  if (!(Number(totalBytes) > 0) || !(Number(freeBytes) >= 0)) {
    return null;
  }

  const usedRatio = Math.min(1, Math.max(0, 1 - freeBytes / totalBytes));
  const isLow = freeBytes < 10 * 1024 ** 3;
  return (
    <div className="flex items-center gap-3 text-[11px] text-text/60">
      <div className="h-1.5 w-40 overflow-hidden bg-black/40 ring-1 ring-inset ring-white/10">
        <div
          className={`h-full ${isLow ? "bg-amber-400" : "bg-accent/80"}`}
          style={{ width: `${Math.round(usedRatio * 100)}%` }}
        />
      </div>
      <span className={isLow ? "text-amber-200" : ""}>
        {settingsKitFormatBytes(freeBytes)} free of{" "}
        {settingsKitFormatBytes(totalBytes)}
      </span>
    </div>
  );
};

const FOLDER_WARNING_STYLES = {
  error: {
    icon: "error",
    tone: "border-red-500/40 bg-red-500/10 text-red-100",
  },
  warning: {
    icon: "warning",
    tone: "border-amber-400/35 bg-amber-500/10 text-amber-100",
  },
  info: {
    icon: "lightbulb",
    tone: "border-accent/30 bg-accent/10 text-text/85",
  },
};

const FolderWarnings = ({ warnings, onUsePath, busy }) => {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {warnings.map((warning) => {
        const style =
          FOLDER_WARNING_STYLES[warning.level] || FOLDER_WARNING_STYLES.info;
        return (
          <div
            key={warning.code}
            className={`flex flex-wrap items-center gap-2 border px-3 py-2 text-xs ${style.tone}`}
          >
            <span className="material-symbols-outlined text-[16px] leading-none">
              {style.icon}
            </span>
            <span className="min-w-[200px] flex-1">{warning.message}</span>
            {warning.suggestedPath && onUsePath && (
              <SettingsButton
                icon="auto_fix_high"
                busy={busy}
                onClick={() => onUsePath(warning.suggestedPath)}
              >
                Use {warning.suggestedPath}
              </SettingsButton>
            )}
          </div>
        );
      })}
    </div>
  );
};

const FolderStatusChip = ({ insight, loading }) => {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text/55">
        <span className="material-symbols-outlined animate-spin text-[14px] leading-none">
          progress_activity
        </span>
        Checking...
      </span>
    );
  }

  if (!insight) {
    return null;
  }

  const chips = {
    error: [
      "error",
      "Can't use",
      "border-red-500/40 bg-red-500/10 text-red-100",
    ],
    warning: [
      "warning",
      "Check this",
      "border-amber-400/40 bg-amber-500/10 text-amber-100",
    ],
    ok: insight.exists
      ? [
          "check_circle",
          "Ready",
          "border-emerald-400/35 bg-emerald-500/10 text-emerald-100",
        ]
      : [
          "create_new_folder",
          "Will be created",
          "border-accent/35 bg-accent/10 text-text",
        ],
  };
  const [icon, text, tone] = chips[insight.status] || chips.ok;

  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone}`}
    >
      <span className="material-symbols-outlined text-[13px] leading-none">
        {icon}
      </span>
      {text}
    </span>
  );
};

/**
 * Shows a folder with its health (free space, write access, risky locations)
 * and lets the user change it through the native folder dialog. Picks that
 * can't work are rejected with an explanation instead of being saved.
 */
const FolderPicker = ({
  value,
  onSave,
  dialogTitle = "Choose a folder",
  emptyTitle = "No folder chosen yet",
  emptyDescription = "",
  changeLabel = "Change...",
  chooseLabel = "Choose folder...",
  compact = false,
}) => {
  const { insight, loading, refresh } = useFolderInsight(value);
  const [busy, setBusy] = React.useState(false);
  const [rejection, setRejection] = React.useState(null);
  const hasValue = Boolean(String(value || "").trim());

  const saveFolder = async (targetPath) => {
    setBusy(true);
    setRejection(null);
    try {
      const pickInsight = await window.electronAPI.inspectFolder(targetPath);
      if (pickInsight?.status === "error") {
        setRejection(pickInsight);
        return;
      }

      const result = await onSave?.(pickInsight?.path || targetPath);
      if (result && result.success === false) {
        setRejection({
          path: targetPath,
          warnings: [
            {
              code: "save_failed",
              level: "error",
              message: result.error || "This folder couldn't be saved.",
            },
          ],
        });
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    const picked = await window.electronAPI.selectDirectory({
      title: dialogTitle,
      defaultPath: value || "",
    });
    if (picked) {
      await saveFolder(picked);
    }
  };

  return (
    <div className={`space-y-3 ${compact ? "" : "px-5 py-4"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`material-symbols-outlined text-[28px] leading-none ${
            hasValue ? "text-accent" : "text-text/35"
          }`}
        >
          {hasValue ? "folder_open" : "folder_off"}
        </span>
        <div className="min-w-[200px] flex-1">
          {hasValue ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="break-all font-mono text-[13px] text-text"
                  title={value}
                >
                  {value}
                </span>
                <FolderStatusChip insight={insight} loading={loading} />
              </div>
              <div className="mt-1.5">
                <FolderSpaceBar
                  freeBytes={insight?.freeBytes}
                  totalBytes={insight?.totalBytes}
                />
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-text/80">
                {emptyTitle}
              </div>
              {emptyDescription && (
                <div className="mt-0.5 text-xs text-text/55">
                  {emptyDescription}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasValue && insight?.exists && (
            <SettingsButton
              icon="open_in_new"
              variant="ghost"
              onClick={() => window.electronAPI.openDirectory(value)}
            >
              Open
            </SettingsButton>
          )}
          <SettingsButton
            icon="drive_folder_upload"
            variant={hasValue ? "secondary" : "primary"}
            busy={busy}
            onClick={chooseFolder}
          >
            {hasValue ? changeLabel : chooseLabel}
          </SettingsButton>
        </div>
      </div>

      {rejection && (
        <div className="space-y-1.5">
          <div className="text-xs text-red-200">
            <span className="font-mono">{rejection.path}</span> can't be used:
          </div>
          <FolderWarnings warnings={rejection.warnings} />
        </div>
      )}

      {hasValue && !rejection && (
        <FolderWarnings
          warnings={insight?.warnings}
          onUsePath={saveFolder}
          busy={busy}
        />
      )}
    </div>
  );
};

/**
 * One-click list of suggested folders (drives with free space, the user
 * folder), best first.
 */
const FolderSuggestionList = ({
  suggestions,
  selectedPath = "",
  onSelect,
  actionLabel = "Use",
  hideCurrent = false,
}) => {
  const visibleSuggestions = (suggestions || []).filter(
    (suggestion) => !(hideCurrent && suggestion.isCurrent),
  );
  if (visibleSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {visibleSuggestions.map((suggestion) => {
        const isSelected =
          selectedPath &&
          String(selectedPath).toLowerCase() ===
            String(suggestion.path).toLowerCase();
        return (
          <button
            type="button"
            key={suggestion.path}
            onClick={() => onSelect?.(suggestion)}
            className={`group flex flex-col items-start gap-1.5 border px-4 py-3 text-left transition ${
              isSelected
                ? "border-accent/70 bg-selected shadow-glow-accent"
                : "border-border bg-black/15 hover:border-accent/40 hover:bg-white/5"
            }`}
          >
            <div className="flex w-full items-center gap-2">
              <span
                className={`material-symbols-outlined text-[20px] leading-none ${
                  isSelected ? "text-accent" : "text-text/60"
                }`}
              >
                {isSelected ? "radio_button_checked" : "hard_drive"}
              </span>
              <span className="flex-1 text-sm font-semibold text-text">
                {suggestion.label}
              </span>
              {suggestion.recommended && (
                <span className="border border-glam/50 bg-glam/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-glam">
                  Recommended
                </span>
              )}
              {suggestion.isCurrent && (
                <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text/60">
                  Current
                </span>
              )}
              {!isSelected && onSelect && (
                <span className="text-[11px] text-accent opacity-0 transition group-hover:opacity-100">
                  {actionLabel}
                </span>
              )}
            </div>
            <div className="break-all font-mono text-[12px] text-text/80">
              {suggestion.path}
            </div>
            <div className="text-[11px] text-text/55">{suggestion.reason}</div>
            <FolderSpaceBar
              freeBytes={suggestion.freeBytes}
              totalBytes={suggestion.totalBytes}
            />
          </button>
        );
      })}
    </div>
  );
};

window.settingsKit = {
  formatBytes: settingsKitFormatBytes,
  useAppInfo,
  useAppSettings,
  useFolderInsight,
};
window.SettingsSaveIndicator = SettingsSaveIndicator;
window.SettingsCard = SettingsCard;
window.SettingRow = SettingRow;
window.ToggleSwitch = ToggleSwitch;
window.SettingsButton = SettingsButton;
window.RestartRequiredBadge = RestartRequiredBadge;
window.FolderSpaceBar = FolderSpaceBar;
window.FolderWarnings = FolderWarnings;
window.FolderPicker = FolderPicker;
window.FolderSuggestionList = FolderSuggestionList;
