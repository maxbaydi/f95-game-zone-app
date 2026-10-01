const GeneralSettings = ({ settings, onRunSetup }) => {
  const interfaceSettings = settings.config?.Interface || {};

  return (
    <div className="space-y-5">
      <window.SettingsCard
        icon="desktop_windows"
        title="Window"
        description="What happens when you close or minimize F95Launcher."
      >
        <window.SettingRow
          title="Keep running in the system tray"
          description="Closing the window hides F95Launcher next to the clock, so downloads continue and you still get update notifications. Quit from the tray icon."
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
          title="Launch with Windows"
          description="Starts F95Launcher when you sign in, so update checks, downloads and save sync run without you opening it."
        >
          <window.ToggleSwitch
            label="Launch with Windows"
            checked={Boolean(interfaceSettings.openAtLogin)}
            onChange={(checked) =>
              settings.update("Interface", {
                openAtLogin: checked,
                ...(checked ? { minimizeToTray: true } : {}),
              })
            }
          />
        </window.SettingRow>
        <window.SettingRow
          title="Start in the tray"
          description="Opens hidden next to the clock. Needs the tray option above. Autostart always starts this way."
        >
          <window.ToggleSwitch
            label="Start in the tray"
            checked={Boolean(interfaceSettings.startMinimized)}
            disabled={!interfaceSettings.minimizeToTray}
            onChange={(checked) =>
              settings.update("Interface", { startMinimized: checked })
            }
          />
        </window.SettingRow>
      </window.SettingsCard>

      <AutomationSettingsCard settings={settings} />

      {onRunSetup && (
        <window.SettingsCard
          icon="auto_awesome"
          title="Setup assistant"
          description="The same short walkthrough as on first launch: games folder, games you already have and accounts."
        >
          <window.SettingRow
            title="Run the setup assistant again"
            description="Nothing is reset. Every step shows your current choice, so you can keep it or change it."
          >
            <window.SettingsButton icon="play_arrow" onClick={onRunSetup}>
              Start
            </window.SettingsButton>
          </window.SettingRow>
        </window.SettingsCard>
      )}
    </div>
  );
};

/**
 * Everything the launcher does on its own in the background. Each switch
 * maps to one job in the main process; nothing here needs a restart.
 */
const AutomationSettingsCard = ({ settings }) => {
  const library = settings.config?.Library || {};
  const appUpdates = settings.config?.AppUpdates || {};
  const liveUpdates = settings.config?.LiveUpdates || {};

  return (
    <window.SettingsCard
      icon="autorenew"
      title="Background work"
      description="What F95Launcher does by itself while it runs. Turn off anything you would rather trigger by hand."
    >
      <window.SettingRow
        title="Look for new games at startup"
        description="A quick scan of your library and scan folders a few seconds after launch. Only clearly identified games are added; anything unsure waits in Scan Hub."
      >
        <window.ToggleSwitch
          label="Look for new games at startup"
          checked={library.autoScanOnStartup !== false}
          onChange={(checked) =>
            settings.update("Library", { autoScanOnStartup: checked })
          }
        />
      </window.SettingRow>
      <window.SettingRow
        title="Keep the game catalog up to date"
        description="Reads the F95 game list every 6 hours and after the PC wakes up: names, versions, engines, tags and covers for folder matching, Link to catalog and site search. The first run walks the whole list once; later runs only fetch what changed. Needs an F95 login."
      >
        <window.ToggleSwitch
          label="Keep the game catalog up to date"
          checked={library.catalogAutoSync !== false}
          onChange={(checked) =>
            settings.update("Library", { catalogAutoSync: checked })
          }
        />
      </window.SettingRow>
      <window.SettingRow
        title="Check every installed game for updates"
        description="The background check reads the F95 thread of favorites every 6 hours. With this on it also walks through the rest of the library, 40 games per run, and after the PC wakes up."
      >
        <window.ToggleSwitch
          label="Check every installed game for updates"
          checked={Boolean(liveUpdates.allGames)}
          onChange={(checked) =>
            settings.update("LiveUpdates", { allGames: checked })
          }
        />
      </window.SettingRow>
      <window.SettingRow
        title="Download app updates automatically"
        description="A new F95Launcher version is downloaded in the background and installed when you quit. Turn off to download and install by hand from the status bar."
      >
        <window.ToggleSwitch
          label="Download app updates automatically"
          checked={appUpdates.autoDownload !== false}
          onChange={(checked) =>
            settings.update("AppUpdates", { autoDownload: checked })
          }
        />
      </window.SettingRow>
      <window.SettingRow
        title="Weekly library backup"
        description="A snapshot of the library list once a week at startup; the last four automatic copies are kept. Backups you make yourself are never removed."
      >
        <window.ToggleSwitch
          label="Weekly library backup"
          checked={library.autoBackup !== false}
          onChange={(checked) =>
            settings.update("Library", { autoBackup: checked })
          }
        />
      </window.SettingRow>
    </window.SettingsCard>
  );
};

const NotificationSettings = ({ settings }) => {
  const notifications = settings.config?.Notifications || {};

  return (
    <window.SettingsCard
      icon="notifications_active"
      title="System notifications"
      description="Shown by Windows even when F95Launcher is in the tray."
    >
      <window.SettingRow
        title="Game updates"
        description="When games in your library get a new version on F95."
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
        title="F95Launcher updates"
        description="When a new version of the app is available or ready to install."
      >
        <window.ToggleSwitch
          label="App update notifications"
          checked={notifications.appUpdates !== false}
          onChange={(checked) =>
            settings.update("Notifications", { appUpdates: checked })
          }
        />
      </window.SettingRow>
      <window.SettingRow
        title="Finished and failed installs"
        description="When a download has been unpacked into your library, or stopped and needs you. Only while the F95Launcher window is not in front."
      >
        <window.ToggleSwitch
          label="Install notifications"
          checked={notifications.installs !== false}
          onChange={(checked) =>
            settings.update("Notifications", { installs: checked })
          }
        />
      </window.SettingRow>
    </window.SettingsCard>
  );
};

const MOTION_OPTIONS = [
  {
    value: "auto",
    label: "System",
    hint: "Follows the Windows animation setting",
  },
  { value: "full", label: "Full", hint: "Smooth transitions everywhere" },
  { value: "reduced", label: "Reduced", hint: "Short, subtle transitions" },
  { value: "off", label: "Off", hint: "No animations" },
];

// Segmented control with a highlight that slides to the active option.
const MotionSegmented = ({ value, onChange }) => {
  const activeIndex = Math.max(
    0,
    MOTION_OPTIONS.findIndex((option) => option.value === value),
  );
  const count = MOTION_OPTIONS.length;
  return (
    <div
      role="radiogroup"
      aria-label="Interface animations"
      className="relative grid border border-border bg-black/30 p-0.5"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute bottom-0.5 top-0.5 bg-accent/85 shadow-glow-accent transition-[left] duration-600 ease-spring"
        style={{
          width: `calc((100% - 4px) / ${count})`,
          left: `calc(2px + (100% - 4px) / ${count} * ${activeIndex})`,
        }}
      />
      {MOTION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={`relative z-10 px-3 py-1 text-xs font-semibold transition-colors duration-500 ${
            option.value === value
              ? "text-onAccent"
              : "text-text/75 hover:text-text"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

const AppearanceSettings = ({ settings }) => {
  const interfaceSettings = settings.config?.Interface || {};
  const motion =
    interfaceSettings.motion ||
    document.documentElement.getAttribute("data-motion") ||
    "auto";
  const motionHint =
    MOTION_OPTIONS.find((option) => option.value === motion)?.hint || "";
  const [templates, setTemplates] = React.useState([]);
  const [selectedTemplate, setSelectedTemplate] = React.useState("Default");
  const [templateChanged, setTemplateChanged] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    Promise.all([
      window.electronAPI.getAvailableBannerTemplates().catch(() => []),
      window.electronAPI.getSelectedBannerTemplate().catch(() => "Default"),
    ]).then(([available, selected]) => {
      if (!alive) {
        return;
      }
      setTemplates(Array.isArray(available) ? available : []);
      setSelectedTemplate(selected || "Default");
    });
    return () => {
      alive = false;
    };
  }, []);

  const chooseTemplate = async (template) => {
    setSelectedTemplate(template);
    const result = await window.electronAPI.setSelectedBannerTemplate(template);
    if (result?.success) {
      setTemplateChanged(true);
      settings.markSaved();
    }
  };

  const chooseMotion = (value) => {
    window.AppUI?.motion.apply(value);
    settings.update("Interface", { motion: value });
  };

  return (
    <div className="space-y-5">
      <window.SettingsCard
        icon="animation"
        title="Animations"
        description="Transitions between screens, dialogs and lists."
      >
        <window.SettingRow
          title="Interface animations"
          description={`${motionHint}. Applies instantly to every window.`}
        >
          <MotionSegmented value={motion} onChange={chooseMotion} />
        </window.SettingRow>
      </window.SettingsCard>
      <window.SettingsCard
        icon="dashboard"
        title="Library layout"
        description="How your games are shown."
      >
        <window.SettingRow
          title="Titles list"
          description="A compact list of game titles next to the cover grid. You can also toggle it with Hide titles in the library."
        >
          <window.ToggleSwitch
            label="Show the titles list"
            checked={interfaceSettings.showGameList !== false}
            onChange={(checked) =>
              settings.update("Interface", { showGameList: checked })
            }
          />
        </window.SettingRow>
        {templates.length > 0 && (
          <window.SettingRow
            title="Game card style"
            description="Custom card templates from the app's templates folder."
            badge={
              templateChanged && (
                <window.RestartRequiredBadge onRestart={settings.onRestart} />
              )
            }
          >
            <select
              value={selectedTemplate}
              onChange={(event) => chooseTemplate(event.target.value)}
              className="min-w-[180px] border border-border bg-black/30 px-2 py-1.5 text-sm text-text outline-none focus:border-accent/60"
            >
              {["Default", ...templates].map((template) => (
                <option key={template} value={template} className="bg-primary">
                  {template}
                </option>
              ))}
            </select>
          </window.SettingRow>
        )}
      </window.SettingsCard>
    </div>
  );
};

const describeAppUpdateState = (state) => {
  switch (state?.status) {
    case "checking":
      return "Checking for updates...";
    case "available":
      return `Version ${state.availableVersion || ""} is available.`;
    case "downloading":
      return `Downloading update: ${Math.round(state.percent || 0)}%`;
    case "downloaded":
      return `Version ${state.availableVersion || ""} is ready to install.`;
    case "not-available":
      return "You have the latest version.";
    case "error":
      return `Couldn't check for updates: ${state.error || "unknown error"}`;
    default:
      return "";
  }
};

const AboutSettings = ({ settings, appInfo }) => {
  const [updateState, setUpdateState] = React.useState(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [debugChanged, setDebugChanged] = React.useState(false);
  const interfaceSettings = settings.config?.Interface || {};

  React.useEffect(() => {
    window.electronAPI
      .getAppUpdateState()
      .then((state) => setUpdateState(state || null))
      .catch(() => {});
  }, []);

  const checkForUpdates = async () => {
    setIsChecking(true);
    try {
      await window.electronAPI.checkAppUpdate();
    } finally {
      const state = await window.electronAPI
        .getAppUpdateState()
        .catch(() => null);
      setUpdateState(state);
      setIsChecking(false);
    }
  };

  const updateAction =
    updateState?.status === "downloaded"
      ? {
          label: "Restart & install",
          icon: "system_update_alt",
          run: () => window.electronAPI.installAppUpdate(),
        }
      : updateState?.status === "available" && updateState?.supportsDownload
        ? {
            label: "Download update",
            icon: "download",
            run: async () => {
              await window.electronAPI.downloadAppUpdate();
              setUpdateState(await window.electronAPI.getAppUpdateState());
            },
          }
        : null;

  const folderRows = [
    [
      "App data",
      "Library database, settings and backups.",
      appInfo?.paths?.data,
    ],
    ["Logs", "Attach these when reporting a problem.", appInfo?.paths?.logs],
    [
      "Download cache",
      "Temporary files while a game downloads.",
      appInfo?.paths?.downloads,
    ],
  ].filter(([, , folderPath]) => folderPath);

  return (
    <div className="space-y-5">
      <window.SettingsCard
        icon="rocket_launch"
        title={`F95Launcher ${appInfo?.version ? `v${appInfo.version}` : ""}`}
        description={
          describeAppUpdateState(updateState) ||
          "Keep the app up to date for new mirror support and fixes."
        }
        actions={
          <>
            {updateAction && (
              <window.SettingsButton
                icon={updateAction.icon}
                variant="primary"
                onClick={updateAction.run}
              >
                {updateAction.label}
              </window.SettingsButton>
            )}
            <window.SettingsButton
              icon="update"
              busy={isChecking || updateState?.status === "checking"}
              onClick={checkForUpdates}
            >
              Check for updates
            </window.SettingsButton>
          </>
        }
      />

      {folderRows.length > 0 && (
        <window.SettingsCard
          icon="folder_managed"
          title="App folders"
          description="Where F95Launcher keeps its own files. Your games are not stored here unless no games folder is chosen."
        >
          {folderRows.map(([title, description, folderPath]) => (
            <window.SettingRow
              key={title}
              title={title}
              description={
                <>
                  {description}{" "}
                  <span className="break-all font-mono text-text/45">
                    {folderPath}
                  </span>
                </>
              }
            >
              <window.SettingsButton
                icon="open_in_new"
                variant="ghost"
                onClick={() => window.electronAPI.openDirectory(folderPath)}
              >
                Open
              </window.SettingsButton>
            </window.SettingRow>
          ))}
        </window.SettingsCard>
      )}

      <window.SettingsCard icon="bug_report" title="Troubleshooting">
        <window.SettingRow
          title="Developer console"
          description="Opens the developer tools with each window. Useful when reporting a bug."
          badge={
            debugChanged && (
              <window.RestartRequiredBadge onRestart={settings.onRestart} />
            )
          }
        >
          <window.ToggleSwitch
            label="Developer console"
            checked={Boolean(interfaceSettings.showDebugConsole)}
            onChange={(checked) => {
              setDebugChanged(true);
              settings.update("Interface", { showDebugConsole: checked });
            }}
          />
        </window.SettingRow>
      </window.SettingsCard>
    </div>
  );
};

window.GeneralSettings = GeneralSettings;
window.NotificationSettings = NotificationSettings;
window.AppearanceSettings = AppearanceSettings;
window.AboutSettings = AboutSettings;
