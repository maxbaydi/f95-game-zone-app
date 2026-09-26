const MOTION_OPTIONS = [
  { value: "auto", label: "System", hint: "Follow the Windows animation setting" },
  { value: "full", label: "Full", hint: "Smooth 400–700ms transitions everywhere" },
  { value: "reduced", label: "Reduced", hint: "Short, subtle transitions" },
  { value: "off", label: "Off", hint: "No animations" },
];

// Animated on/off switch shared by the settings pages.
const SettingsToggle = ({ checked, onChange, label, disabled = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange?.(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center border transition-[background-color,border-color,box-shadow] duration-500 disabled:cursor-not-allowed disabled:opacity-50 ${
      checked
        ? "border-accent/70 bg-accent/80 shadow-glow-accent"
        : "border-border bg-black/30 hover:border-accent/40"
    }`}
  >
    <span
      className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 shadow transition-[left,background-color] duration-500 ease-spring ${
        checked ? "left-[22px] bg-white" : "left-[3px] bg-text/60"
      }`}
    />
  </button>
);

const SettingsRow = ({ title, description, children, index = 0 }) => (
  <div
    className="atlas-list-enter flex items-center gap-4 border-b border-border/50 py-4 last:border-b-0"
    style={{ "--atlas-index": index }}
  >
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-text">{title}</div>
      {description && (
        <div className="mt-1 text-xs leading-5 text-text/55">{description}</div>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

// Segmented control with a sliding highlight behind the active option.
const SettingsSegmented = ({ options, value, onChange, label }) => {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative grid border border-border bg-black/30 p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute bottom-0.5 top-0.5 bg-accent/85 shadow-glow-accent transition-[left] duration-600 ease-spring"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          left: `calc(2px + (100% - 4px) / ${options.length} * ${activeIndex})`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.hint}
          onClick={() => onChange?.(option.value)}
          className={`relative z-10 px-3 py-1 text-xs font-semibold transition-colors duration-500 ${
            option.value === value ? "text-onAccent" : "text-text/75 hover:text-text"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

window.SettingsToggle = SettingsToggle;
window.SettingsRow = SettingsRow;
window.SettingsSegmented = SettingsSegmented;

const saveInterfaceSettings = (patch, options) =>
  window.AtlasSettings
    ? window.AtlasSettings.save("Interface", patch, options)
    : window.electronAPI.getConfig().then((config) =>
        window.electronAPI.saveSettings({
          ...config,
          Interface: { ...config.Interface, ...patch },
        }),
      );

const notifyRestartRequired = (what) => {
  window.AtlasToast?.info(`${what} will apply after F95Launcher restarts.`, {
    title: "Restart required",
    duration: 5000,
  });
};

const Interface = () => {
  const [language, setLanguage] = React.useState("English");
  const [atlasStartup, setAtlasStartup] = React.useState("Do Nothing");
  const [gameStartup, setGameStartup] = React.useState("Do Nothing");
  const [showDebugConsole, setShowDebugConsole] = React.useState(false);
  const [minimizeToTray, setMinimizeToTray] = React.useState(false);
  const [showSidebar, setShowSidebar] = React.useState(true);
  const [motion, setMotion] = React.useState(
    () => document.documentElement.getAttribute("data-motion") || "auto",
  );
  const [isLoaded, setIsLoaded] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const load = window.AtlasSettings
      ? window.AtlasSettings.load()
      : window.electronAPI.getConfig();
    Promise.resolve(load)
      .then((config) => {
        if (!active) {
          return;
        }
        const interfaceSettings = config?.Interface || {};
        setLanguage(interfaceSettings.language || "English");
        setAtlasStartup(interfaceSettings.atlasStartup || "Do Nothing");
        setGameStartup(interfaceSettings.gameStartup || "Do Nothing");
        setShowDebugConsole(
          interfaceSettings.showDebugConsole === true ||
            interfaceSettings.showDebugConsole === "true",
        );
        setMinimizeToTray(
          interfaceSettings.minimizeToTray === true ||
            interfaceSettings.minimizeToTray === "true",
        );
        setShowSidebar(
          interfaceSettings.showSidebar !== false &&
            interfaceSettings.showSidebar !== "false",
        );
        if (interfaceSettings.motion) {
          setMotion(String(interfaceSettings.motion));
        }
      })
      .catch((error) => console.error("Failed to load interface settings:", error))
      .finally(() => {
        if (active) {
          setIsLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleMotionChange = (value) => {
    setMotion(value);
    window.AtlasUI?.motion.apply(value);
    saveInterfaceSettings({ motion: value }, { message: "Animation preference saved." }).catch(
      () => {},
    );
  };

  const handleLanguageChange = (e) => {
    setLanguage(e.target.value);
    saveInterfaceSettings({ language: e.target.value }, { silent: true })
      .then(() => notifyRestartRequired("The new language"))
      .catch(() => {});
  };

  const handleAtlasStartupChange = (e) => {
    setAtlasStartup(e.target.value);
    saveInterfaceSettings({ atlasStartup: e.target.value }).catch(() => {});
  };

  const handleGameStartupChange = (e) => {
    setGameStartup(e.target.value);
    saveInterfaceSettings({ gameStartup: e.target.value }).catch(() => {});
  };

  const handleDebugConsoleChange = (next) => {
    setShowDebugConsole(next);
    saveInterfaceSettings({ showDebugConsole: next }, { silent: true })
      .then(() => notifyRestartRequired("The debug console setting"))
      .catch(() => setShowDebugConsole(!next));
  };

  const handleMinimizeToTrayChange = (next) => {
    setMinimizeToTray(next);
    saveInterfaceSettings({ minimizeToTray: next }).catch(() =>
      setMinimizeToTray(!next),
    );
  };

  const handleShowSidebarChange = (next) => {
    setShowSidebar(next);
    saveInterfaceSettings({ showSidebar: next }, { silent: true })
      .then(() => notifyRestartRequired("Sidebar visibility"))
      .catch(() => setShowSidebar(!next));
  };

  const selectClassName =
    "w-44 cursor-pointer border border-border bg-secondary p-1.5 text-text outline-none transition-colors duration-500 hover:border-accent/40 focus:border-accent/60";

  if (!isLoaded) {
    return (
      <div className="space-y-4 p-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <div className="atlas-skeleton h-3.5 w-48" />
              <div className="atlas-skeleton h-3 w-72" />
            </div>
            <div className="atlas-skeleton h-6 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const activeMotionHint =
    MOTION_OPTIONS.find((option) => option.value === motion)?.hint || "";

  return (
    <div className="p-5 text-text">
      <SettingsRow
        index={0}
        title="Interface animations"
        description={`${activeMotionHint}. Applies instantly to every window.`}
      >
        <SettingsSegmented
          label="Interface animations"
          options={MOTION_OPTIONS}
          value={motion}
          onChange={handleMotionChange}
        />
      </SettingsRow>
      <SettingsRow
        index={1}
        title="Language"
        description="Changing the language requires a restart."
      >
        <select
          className={selectClassName}
          value={language}
          onChange={handleLanguageChange}
        >
          <option>English</option>
        </select>
      </SettingsRow>
      <SettingsRow
        index={2}
        title="When F95Launcher starts"
        description="Default app behavior on launch."
      >
        <select
          className={selectClassName}
          value={atlasStartup}
          onChange={handleAtlasStartupChange}
        >
          <option>Do Nothing</option>
        </select>
      </SettingsRow>
      <SettingsRow
        index={3}
        title="When a game starts"
        description="Takes effect once the game has fully launched."
      >
        <select
          className={selectClassName}
          value={gameStartup}
          onChange={handleGameStartupChange}
        >
          <option>Do Nothing</option>
        </select>
      </SettingsRow>
      <SettingsRow
        index={4}
        title="Keep F95Launcher in the system tray"
        description="The app stays available from the tray when minimized or closed and can notify you when updates are ready."
      >
        <SettingsToggle
          label="Keep F95Launcher in the system tray"
          checked={minimizeToTray}
          onChange={handleMinimizeToTrayChange}
        />
      </SettingsRow>
      <SettingsRow
        index={5}
        title="Show sidebar"
        description="Hide or show the left sidebar. Requires a restart."
      >
        <SettingsToggle
          label="Show sidebar"
          checked={showSidebar}
          onChange={handleShowSidebarChange}
        />
      </SettingsRow>
      <SettingsRow
        index={6}
        title="Show debug console window"
        description="Opens developer tools with every window. Requires a restart."
      >
        <SettingsToggle
          label="Show debug console window"
          checked={showDebugConsole}
          onChange={handleDebugConsoleChange}
        />
      </SettingsRow>
    </div>
  );
};

window.Interface = Interface;
