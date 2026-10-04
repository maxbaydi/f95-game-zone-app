const ONBOARDING_STEPS = ["welcome", "folder", "scan", "saves", "accounts", "done"];
const ONBOARDING_STEP_LABELS = {
  folder: "Games folder",
  scan: "Your games",
  saves: "Saves",
  accounts: "F95 account",
  done: "Done",
};

const onboardingSamePath = (left, right) =>
  String(left || "")
    .trim()
    .toLowerCase() ===
  String(right || "")
    .trim()
    .toLowerCase();

const OnboardingStepper = ({ step, hasGameFolder, onJump }) => {
  const visibleSteps = ONBOARDING_STEPS.filter((entry) => entry !== "welcome");
  const currentIndex = visibleSteps.indexOf(step);

  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {visibleSteps.map((entry, index) => {
        const isSkippedFolder = entry === "folder" && !hasGameFolder;
        const state =
          index === currentIndex
            ? "active"
            : index < currentIndex && !isSkippedFolder
              ? "done"
              : "todo";
        const canJump = index < currentIndex && onJump;
        return (
          <li key={entry} className="flex items-center gap-2">
            {index > 0 && <span className="h-px w-6 bg-border" />}
            <button
              type="button"
              disabled={!canJump}
              onClick={() => canJump && onJump(entry)}
              className={`flex items-center gap-1.5 border px-2 py-1 disabled:cursor-default ${
                state === "active"
                  ? "border-accent/70 bg-selected text-text"
                  : state === "done"
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                    : "border-border text-text/45 enabled:hover:text-text"
              }`}
            >
              <span className="material-symbols-outlined text-[14px] leading-none">
                {state === "done"
                  ? "check"
                  : state === "active"
                    ? "radio_button_checked"
                    : "radio_button_unchecked"}
              </span>
              {ONBOARDING_STEP_LABELS[entry]}
            </button>
          </li>
        );
      })}
    </ol>
  );
};

const OnboardingFeature = ({ icon, title, text }) => (
  <div className="border border-border bg-black/20 p-4">
    <span className="material-symbols-outlined text-[26px] leading-none text-accent">
      {icon}
    </span>
    <div className="mt-3 text-sm font-semibold text-text">{title}</div>
    <div className="mt-1 text-xs leading-relaxed text-text/60">{text}</div>
  </div>
);

const OnboardingWelcomeStep = () => (
  <div className="flex flex-col items-center text-center">
    <img
      src="./assets/images/logo.png"
      alt=""
      className="h-20 w-20 object-contain"
      draggable={false}
    />
    <h1 className="mt-4 text-3xl font-semibold text-text">
      Welcome to F95Launcher
    </h1>
    <p className="mt-3 max-w-xl text-sm leading-relaxed text-text/70">
      Your games, their updates and your saves in one place. Let's get your
      library ready: it takes about a minute, and every choice can be changed
      later in Settings.
    </p>
    <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
      <OnboardingFeature
        icon="download"
        title="Install in one click"
        text="Pick a game on F95 and it downloads, unpacks and lands in your library by itself."
      />
      <OnboardingFeature
        icon="update"
        title="Stay up to date"
        text="See new versions of your games and update them without hunting for links."
      />
      <OnboardingFeature
        icon="cloud_sync"
        title="Keep your saves safe"
        text="Back up saves to your own cloud folder and get them back on any PC."
      />
    </div>
  </div>
);

const OnboardingFolderStep = ({
  selectedPath,
  onSelectPath,
  suggestions,
  insight,
  insightLoading,
}) => {
  const chooseOther = async () => {
    const picked = await window.electronAPI.selectDirectory({
      title: "Choose where F95Launcher installs games",
      defaultPath: selectedPath || "",
    });
    if (picked) {
      onSelectPath(picked);
    }
  };

  const hasSuggestion = suggestions.some((suggestion) =>
    onboardingSamePath(suggestion.path, selectedPath),
  );
  const listed =
    selectedPath && !hasSuggestion
      ? [
          ...suggestions,
          {
            path: selectedPath,
            label: "Your choice",
            reason: "Picked by you.",
            freeBytes: insight?.freeBytes ?? null,
            totalBytes: insight?.totalBytes ?? null,
          },
        ]
      : suggestions;

  return (
    <div>
      <h2 className="text-2xl font-semibold text-text">
        Where should games be installed?
      </h2>
      <p className="mt-2 text-sm text-text/65">
        Choose a place with plenty of free space. F95Launcher creates the folder
        if it doesn't exist yet. Your saves are not affected.
      </p>

      <div className="mt-5">
        <window.FolderSuggestionList
          suggestions={listed}
          selectedPath={selectedPath}
          onSelect={(suggestion) => onSelectPath(suggestion.path)}
          actionLabel="Select"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <window.SettingsButton icon="folder_open" onClick={chooseOther}>
          Choose another folder...
        </window.SettingsButton>
        {insightLoading && (
          <span className="text-xs text-text/55">Checking the folder...</span>
        )}
      </div>

      {selectedPath && insight && insight.warnings?.length > 0 && (
        <div className="mt-4">
          <window.FolderWarnings
            warnings={insight.warnings}
            onUsePath={onSelectPath}
          />
        </div>
      )}
    </div>
  );
};

const OnboardingScanStep = ({
  detected,
  checkedPaths,
  onTogglePath,
  onAddFolder,
}) => (
  <div>
    <h2 className="text-2xl font-semibold text-text">
      Do you already have games on this PC?
    </h2>
    <p className="mt-2 text-sm text-text/65">
      Tick the folders where you keep downloaded games. F95Launcher adds what it
      finds to your library. Nothing is moved or deleted.
    </p>

    <div className="mt-5 space-y-2">
      {detected === null ? (
        <div className="flex items-center gap-3 border border-border bg-black/15 px-4 py-6 text-sm text-text/70">
          <span className="material-symbols-outlined animate-spin text-[22px] leading-none text-accent">
            progress_activity
          </span>
          Looking in Downloads, Desktop and Games folders...
        </div>
      ) : detected.length === 0 ? (
        <div className="border border-border bg-black/15 px-4 py-5 text-sm text-text/70">
          <div className="flex items-center gap-2 font-medium text-text">
            <span className="material-symbols-outlined text-[20px] leading-none text-text/55">
              search_off
            </span>
            No games found in the usual places
          </div>
          <div className="mt-1 text-xs text-text/55">
            Add the folder where you keep them, or skip this step and download
            games from F95 right inside the app.
          </div>
        </div>
      ) : (
        detected.map((folder) => {
          const isChecked =
            folder.alreadyAdded || checkedPaths.includes(folder.path);
          return (
            <label
              key={folder.path}
              className={`flex cursor-pointer flex-wrap items-center gap-3 border px-4 py-3 transition ${
                isChecked
                  ? "border-accent/60 bg-selected"
                  : "border-border bg-black/15 hover:bg-white/5"
              } ${folder.alreadyAdded ? "cursor-default opacity-80" : ""}`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#66c0f4]"
                checked={isChecked}
                disabled={folder.alreadyAdded}
                onChange={() => onTogglePath(folder.path)}
              />
              <span className="material-symbols-outlined text-[22px] leading-none text-text/60">
                folder_special
              </span>
              <span className="min-w-[220px] flex-1 break-all font-mono text-[13px] text-text">
                {folder.path}
              </span>
              <span className="text-xs text-emerald-200">
                {folder.alreadyAdded
                  ? "Already added"
                  : folder.gameCount > 0
                    ? `${folder.gameCount} ${folder.gameCount === 1 ? "game" : "games"} found`
                    : "Added by you"}
              </span>
            </label>
          );
        })
      )}
    </div>

    <div className="mt-3">
      <window.SettingsButton icon="create_new_folder" onClick={onAddFolder}>
        Add another folder...
      </window.SettingsButton>
    </div>
  </div>
);

const OnboardingAccountCard = ({
  icon,
  title,
  text,
  connected,
  connectedText,
  actionLabel,
  onAction,
}) => (
  <div
    className={`flex flex-col border p-5 ${
      connected
        ? "border-emerald-400/40 bg-emerald-500/5"
        : "border-border bg-black/15"
    }`}
  >
    <div className="flex items-center gap-3">
      <span className="material-symbols-outlined text-[28px] leading-none text-accent">
        {icon}
      </span>
      <div className="flex-1 text-base font-semibold text-text">{title}</div>
      {connected && (
        <span className="material-symbols-outlined text-[22px] leading-none text-emerald-300">
          check_circle
        </span>
      )}
    </div>
    <p className="mt-2 flex-1 text-xs leading-relaxed text-text/60">{text}</p>
    <div className="mt-4">
      {connected ? (
        <div className="text-sm text-emerald-100">{connectedText}</div>
      ) : (
        <window.SettingsButton
          icon="login"
          variant="primary"
          onClick={onAction}
        >
          {actionLabel}
        </window.SettingsButton>
      )}
    </div>
  </div>
);

const OnboardingSavesStep = ({ onConnected }) => (
  <div>
    <h2 className="text-2xl font-semibold text-text">Where should your saves live?</h2>
    <p className="mt-2 text-sm text-text/65">
      Saves always stay on this PC and get a local safety copy before anything
      overwrites them. To carry them to another PC, pick a cloud you already
      use: F95Launcher keeps a folder there up to date and the cloud client
      does the rest. No account with us. Optional, and easy to change later.
    </p>
    <div className="mt-5">
      {window.SaveStorageQuickSetup ? (
        <window.SaveStorageQuickSetup onConnected={onConnected} />
      ) : (
        <div className="text-sm text-text/60">Save storage is set up in Settings.</div>
      )}
    </div>
  </div>
);

const OnboardingAccountsStep = ({ f95Connected }) => (
  <div>
    <h2 className="text-2xl font-semibold text-text">Connect your F95 account</h2>
    <p className="mt-2 text-sm text-text/65">
      Optional and free. You can also log in later from Search.
    </p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <OnboardingAccountCard
        icon="travel_explore"
        title="F95Zone"
        text="Needed to browse F95 inside the app, download games in one click and check your library for updates."
        connected={f95Connected}
        connectedText="Signed in. Downloads and updates are ready."
        actionLabel="Log in to F95"
        onAction={() => window.electronAPI.openF95Login()}
      />
    </div>
  </div>
);

const OnboardingSummaryRow = ({ ok, text }) => (
  <li className="flex items-start gap-3 py-2">
    <span
      className={`material-symbols-outlined mt-px text-[20px] leading-none ${
        ok ? "text-emerald-300" : "text-text/35"
      }`}
    >
      {ok ? "check_circle" : "radio_button_unchecked"}
    </span>
    <span className={`text-sm ${ok ? "text-text" : "text-text/60"}`}>
      {text}
    </span>
  </li>
);

const OnboardingDoneStep = ({
  gameFolder,
  sourcesCount,
  f95Connected,
  saveStorageState,
  settings,
}) => {
  const interfaceSettings = settings.config?.Interface || {};
  const notifications = settings.config?.Notifications || {};
  const usageStats = settings.config?.UsageStats || {};

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-[40px] leading-none text-emerald-300">
          task_alt
        </span>
        <h2 className="text-2xl font-semibold text-text">You're all set</h2>
      </div>
      <ul className="mt-4 divide-y divide-border/60 border-y border-border/60">
        <OnboardingSummaryRow
          ok={Boolean(gameFolder)}
          text={
            gameFolder ? (
              <>
                New games install to{" "}
                <span className="font-mono">{gameFolder}</span>
              </>
            ) : (
              "No games folder chosen: games go to the app's data folder until you pick one in Settings."
            )
          }
        />
        <OnboardingSummaryRow
          ok={sourcesCount > 0}
          text={
            sourcesCount > 0
              ? `${sourcesCount} ${sourcesCount === 1 ? "folder" : "folders"} will be scanned now. Your games appear in the library in a moment.`
              : "No existing games added. You can add folders any time in Settings."
          }
        />
        <OnboardingSummaryRow
          ok={f95Connected}
          text={
            f95Connected
              ? "F95 connected"
              : "F95 not connected: log in from Search when you need it."
          }
        />
        <OnboardingSummaryRow
          ok={Boolean(saveStorageState?.connected)}
          text={
            saveStorageState?.connected
              ? `Saves are backed up to ${saveStorageState.label || "your storage"}`
              : "Saves stay on this PC only: connect a cloud folder any time in Settings → Save storage."
          }
        />
      </ul>

      <div className="mt-5 border border-border bg-black/15">
        <window.SettingRow
          title="Keep running in the system tray"
          description="Downloads continue and update alerts still arrive after you close the window."
        >
          <window.ToggleSwitch
            label="Keep running in the system tray"
            checked={Boolean(interfaceSettings.minimizeToTray)}
            onChange={(checked) =>
              settings.update("Interface", { minimizeToTray: checked })
            }
          />
        </window.SettingRow>
        <window.SettingRow
          title="Tell me when my games get updates"
          description="A Windows notification when a new version appears on F95."
        >
          <window.ToggleSwitch
            label="Game update notifications"
            checked={notifications.libraryUpdates !== false}
            onChange={(checked) =>
              settings.update("Notifications", { libraryUpdates: checked })
            }
          />
        </window.SettingRow>
        <window.SettingRow
          title="Send anonymous usage statistics"
          description="Once a day: a random ID, the app version, the OS and the processor type, so the developer knows how many people use the app. Nothing about your games, files or accounts."
        >
          <window.ToggleSwitch
            label="Send anonymous usage statistics"
            checked={usageStats.enabled !== false}
            onChange={(checked) =>
              settings.update("UsageStats", { enabled: checked })
            }
          />
        </window.SettingRow>
      </div>
    </div>
  );
};

const OnboardingWizard = ({
  isOpen,
  initialStep = "welcome",
  onFinish,
}) => {
  const settings = window.settingsKit.useAppSettings();
  const saveStorage = window.useSaveStorageState
    ? window.useSaveStorageState()
    : { state: null, refresh: () => Promise.resolve(null) };
  const [step, setStep] = React.useState(initialStep);
  const [suggestions, setSuggestions] = React.useState([]);
  const [selectedPath, setSelectedPath] = React.useState("");
  const [detected, setDetected] = React.useState(null);
  const [checkedPaths, setCheckedPaths] = React.useState([]);
  const [sourcesCount, setSourcesCount] = React.useState(0);
  const [f95Connected, setF95Connected] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const { insight, loading: insightLoading } =
    window.settingsKit.useFolderInsight(selectedPath);
  const gameFolder = String(settings.config?.Library?.gameFolder || "").trim();

  React.useEffect(() => {
    if (isOpen) {
      setStep(initialStep);
      setError("");
      setDetected(null);
    }
  }, [isOpen, initialStep]);

  React.useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    let alive = true;
    window.electronAPI
      .suggestLibraryFolders()
      .then((result) => {
        if (!alive) {
          return;
        }
        const list = Array.isArray(result) ? result : [];
        setSuggestions(list);
        setSelectedPath((previous) => {
          if (previous) {
            return previous;
          }
          const current = list.find((suggestion) => suggestion.isCurrent);
          const recommended = list.find((suggestion) => suggestion.recommended);
          return (current || recommended || list[0])?.path || "";
        });
      })
      .catch(() => {});

    window.electronAPI
      .getF95AuthStatus()
      .then(
        (state) => alive && setF95Connected(Boolean(state?.isAuthenticated)),
      )
      .catch(() => {});
    const unsubscribe = window.electronAPI.subscribeF95AuthChanged?.(
      (state) => alive && setF95Connected(Boolean(state?.isAuthenticated)),
    );

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [isOpen]);

  const loadDetectedFolders = React.useCallback(async () => {
    setDetected(null);
    const [folders, sourcesResult] = await Promise.all([
      window.electronAPI.detectGameFolders().catch(() => []),
      window.electronAPI.getScanSources().catch(() => null),
    ]);
    const list = Array.isArray(folders) ? folders : [];
    setDetected(list);
    setSourcesCount(
      (sourcesResult?.sources || []).filter((source) => source.isEnabled)
        .length,
    );
    setCheckedPaths(
      list
        .filter((folder) => !folder.alreadyAdded)
        .map((folder) => folder.path),
    );
  }, []);

  React.useEffect(() => {
    if (isOpen && step === "scan" && detected === null) {
      loadDetectedFolders();
    }
  }, [isOpen, step, detected, loadDetectedFolders]);

  if (!isOpen) {
    return null;
  }

  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const goTo = (nextStep) => {
    setError("");
    setStep(nextStep);
  };
  const goNext = () =>
    goTo(
      ONBOARDING_STEPS[Math.min(stepIndex + 1, ONBOARDING_STEPS.length - 1)],
    );
  const goBack = () => goTo(ONBOARDING_STEPS[Math.max(stepIndex - 1, 0)]);

  const markCompleted = () =>
    window.electronAPI.updateSettings("Onboarding", {
      completed: true,
      completedAt: new Date().toISOString(),
    });

  const saveFolderAndContinue = async () => {
    if (!selectedPath) {
      goNext();
      return;
    }
    if (onboardingSamePath(selectedPath, gameFolder) && insight?.exists) {
      goNext();
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result =
        await window.electronAPI.setDefaultGameFolder(selectedPath);
      if (!result?.success) {
        setError(
          result?.error || "This folder can't be used. Choose another one.",
        );
        return;
      }
      setDetected(null);
      goNext();
    } finally {
      setBusy(false);
    }
  };

  const addCheckedFolders = async () => {
    setBusy(true);
    setError("");
    const failures = [];
    try {
      for (const folderPath of checkedPaths) {
        const result = await window.electronAPI.addScanSource(folderPath);
        if (!result?.success) {
          failures.push(folderPath);
        }
      }
      const sourcesResult = await window.electronAPI
        .getScanSources()
        .catch(() => null);
      setSourcesCount(
        (sourcesResult?.sources || []).filter((source) => source.isEnabled)
          .length,
      );
      setDetected((previous) =>
        (previous || []).map((folder) =>
          checkedPaths.includes(folder.path) && !failures.includes(folder.path)
            ? { ...folder, alreadyAdded: true }
            : folder,
        ),
      );
      setCheckedPaths(failures);
      if (failures.length > 0) {
        setError(`Couldn't add: ${failures.join(", ")}`);
        return;
      }
      goNext();
    } finally {
      setBusy(false);
    }
  };

  const addAnotherFolder = async () => {
    const picked = await window.electronAPI.selectDirectory({
      title: "Choose a folder that contains games",
      buttonLabel: "Add this folder",
    });
    if (!picked) {
      return;
    }
    setDetected((previous) => {
      const list = previous || [];
      return list.some((folder) => onboardingSamePath(folder.path, picked))
        ? list
        : [...list, { path: picked, gameCount: 0, alreadyAdded: false }];
    });
    setCheckedPaths((previous) =>
      previous.some((entry) => onboardingSamePath(entry, picked))
        ? previous
        : [...previous, picked],
    );
  };

  const togglePath = (folderPath) =>
    setCheckedPaths((previous) =>
      previous.includes(folderPath)
        ? previous.filter((entry) => entry !== folderPath)
        : [...previous, folderPath],
    );

  const finish = async (goToSection = "") => {
    setBusy(true);
    try {
      await markCompleted();
    } finally {
      setBusy(false);
    }
    onFinish?.({ startScan: sourcesCount > 0, goTo: goToSection });
  };

  const skip = async () => {
    await markCompleted();
    onFinish?.({ startScan: false, goTo: "", skipped: true });
  };

  const primaryAction = {
    welcome: { label: "Get started", icon: "arrow_forward", run: goNext },
    folder: {
      label: selectedPath ? "Use this folder" : "Continue",
      icon: "check",
      run: saveFolderAndContinue,
      disabled: insight?.status === "error" || insightLoading,
    },
    scan: {
      label:
        checkedPaths.length > 0
          ? `Add ${checkedPaths.length} ${checkedPaths.length === 1 ? "folder" : "folders"}`
          : "Continue",
      icon: checkedPaths.length > 0 ? "playlist_add" : "arrow_forward",
      run: checkedPaths.length > 0 ? addCheckedFolders : goNext,
      disabled: detected === null,
    },
    saves: {
      label: saveStorage.state?.connected ? "Continue" : "Keep saves on this PC",
      icon: "arrow_forward",
      run: goNext,
    },
    accounts: { label: "Continue", icon: "arrow_forward", run: goNext },
    done: {
      label: sourcesCount > 0 ? "Scan & open my library" : "Open my library",
      icon: "rocket_launch",
      run: () => finish(""),
    },
  }[step];

  return (
    <div
      className="fixed inset-0 z-[1720] flex items-center justify-center bg-canvas/95 px-4 py-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="F95Launcher setup"
    >
      <div className="flex max-h-full w-full max-w-[900px] flex-col border border-border bg-primary shadow-2xl motion-safe:animate-app-fade-up">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
          {step === "welcome" ? (
            <div className="text-[11px] uppercase tracking-[0.22em] text-accent/80">
              Setup
            </div>
          ) : (
            <OnboardingStepper
              step={step}
              hasGameFolder={Boolean(gameFolder)}
              onJump={busy ? null : goTo}
            />
          )}
          {step !== "done" && (
            <button
              type="button"
              onClick={skip}
              className="ml-auto text-xs text-text/55 underline decoration-dotted underline-offset-4 hover:text-text"
            >
              Skip setup
            </button>
          )}
        </div>

        <div
          key={step}
          className="min-h-[360px] flex-1 overflow-y-auto px-8 py-7 motion-safe:animate-app-fade-up"
        >
          {step === "welcome" && <OnboardingWelcomeStep />}
          {step === "folder" && (
            <OnboardingFolderStep
              selectedPath={selectedPath}
              onSelectPath={setSelectedPath}
              suggestions={suggestions}
              insight={insight}
              insightLoading={insightLoading}
            />
          )}
          {step === "scan" && (
            <OnboardingScanStep
              detected={detected}
              checkedPaths={checkedPaths}
              onTogglePath={togglePath}
              onAddFolder={addAnotherFolder}
            />
          )}
          {step === "saves" && (
            <OnboardingSavesStep onConnected={() => saveStorage.refresh()} />
          )}
          {step === "accounts" && (
            <OnboardingAccountsStep f95Connected={f95Connected} />
          )}
          {step === "done" && (
            <OnboardingDoneStep
              gameFolder={gameFolder}
              sourcesCount={sourcesCount}
              f95Connected={f95Connected}
              saveStorageState={saveStorage.state}
              settings={settings}
            />
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              <span className="material-symbols-outlined text-[16px] leading-none">
                error
              </span>
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
          {stepIndex > 0 && (
            <window.SettingsButton
              icon="arrow_back"
              variant="ghost"
              onClick={goBack}
              disabled={busy}
            >
              Back
            </window.SettingsButton>
          )}
          {(step === "scan" || step === "accounts" || step === "saves") && (
            <button
              type="button"
              onClick={goNext}
              disabled={busy}
              className="text-xs text-text/55 hover:text-text"
            >
              Not now
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {step === "done" && f95Connected && (
              <window.SettingsButton
                icon="travel_explore"
                onClick={() => finish("search")}
                disabled={busy}
              >
                Find games on F95
              </window.SettingsButton>
            )}
            <window.SettingsButton
              variant="primary"
              icon={primaryAction.icon}
              busy={busy}
              disabled={primaryAction.disabled}
              onClick={primaryAction.run}
              className="px-5 py-2 text-sm"
            >
              {primaryAction.label}
            </window.SettingsButton>
          </div>
        </div>
      </div>
    </div>
  );
};

const LibraryGettingStarted = ({
  gameFolder,
  hasScanSources,
  isScanRunning,
  onFindGames,
  onScanNow,
  onBrowseF95,
  onAddGame,
  onOpenLibrarySettings,
}) => {
  const actions = [
    hasScanSources
      ? {
          icon: "radar",
          title: isScanRunning
            ? "Scanning your folders..."
            : "Scan your folders",
          text: "Look for new games in the folders you added.",
          onClick: onScanNow,
          disabled: isScanRunning,
          primary: true,
        }
      : {
          icon: "travel_explore",
          title: "Add games you already have",
          text: "F95Launcher looks for downloaded games on this PC. You tick the folders.",
          onClick: onFindGames,
          primary: true,
        },
    {
      icon: "download",
      title: "Download from F95",
      text: "Browse F95 inside the app and install games in one click.",
      onClick: onBrowseF95,
    },
    {
      icon: "add_circle",
      title: "Add one game manually",
      text: "Pick a single game folder or archive.",
      onClick: onAddGame,
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center text-text">
      <div className="w-full max-w-3xl motion-safe:animate-app-fade-up">
        <span className="material-symbols-outlined text-[44px] leading-none text-accent/80">
          sports_esports
        </span>
        <h2 className="mt-3 text-2xl font-semibold">Your library is empty</h2>
        <p className="mt-2 text-sm text-text/65">
          Pick how you want to add games. You can use all three.
        </p>

        <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
          {actions.map((action) => (
            <button
              key={action.title}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`group flex flex-col border p-5 text-left transition disabled:cursor-wait disabled:opacity-70 ${
                action.primary
                  ? "border-accent/60 bg-selected hover:shadow-glow-accent"
                  : "border-border bg-secondary/60 hover:border-accent/40 hover:bg-white/5"
              }`}
            >
              <span
                className={`material-symbols-outlined text-[28px] leading-none ${
                  action.primary ? "text-accent" : "text-text/70"
                } ${action.disabled ? "animate-spin" : ""}`}
              >
                {action.disabled ? "progress_activity" : action.icon}
              </span>
              <span className="mt-3 text-sm font-semibold">{action.title}</span>
              <span className="mt-1 text-xs leading-relaxed text-text/60">
                {action.text}
              </span>
            </button>
          ))}
        </div>

        <div
          className={`mt-6 flex flex-wrap items-center justify-center gap-2 border px-4 py-3 text-xs ${
            gameFolder
              ? "border-border bg-black/20 text-text/65"
              : "border-amber-400/35 bg-amber-500/10 text-amber-100"
          }`}
        >
          <span className="material-symbols-outlined text-[16px] leading-none">
            {gameFolder ? "folder_open" : "warning"}
          </span>
          {gameFolder ? (
            <>
              New games install to{" "}
              <span className="font-mono text-text/85">{gameFolder}</span>
            </>
          ) : (
            "No games folder chosen yet, so downloads go to the app's data folder."
          )}
          <button
            type="button"
            onClick={onOpenLibrarySettings}
            className="font-semibold text-accent hover:underline"
          >
            {gameFolder ? "Change" : "Choose a folder"}
          </button>
        </div>
      </div>
    </div>
  );
};

window.OnboardingWizard = OnboardingWizard;
window.LibraryGettingStarted = LibraryGettingStarted;
