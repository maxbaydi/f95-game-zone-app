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
      </window.SettingsCard>

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
    </window.SettingsCard>
  );
};

const AppearanceSettings = ({ settings }) => {
  const interfaceSettings = settings.config?.Interface || {};
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

  return (
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
