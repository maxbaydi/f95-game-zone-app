const SETTINGS_PAGES = [
  {
    id: "general",
    label: "General",
    icon: "tune",
    description: "How the app window behaves, and the setup assistant.",
  },
  {
    id: "library",
    label: "Library & folders",
    icon: "folder_open",
    description:
      "Where games are installed and which folders are scanned for games you already have.",
  },
  {
    id: "cloud",
    label: "Cloud saves",
    icon: "cloud",
    description: "Back up your saves and library list to your account.",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "notifications",
    description: "Choose what F95Launcher tells you about.",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: "palette",
    description: "How your library looks.",
  },
  {
    id: "emulators",
    label: "Emulators",
    icon: "sports_esports",
    description: "Open games that need another program, such as Flash files.",
    group: "more",
  },
  {
    id: "about",
    label: "About & help",
    icon: "info",
    description: "Version, updates, app folders and troubleshooting.",
    group: "more",
  },
];

const getSettingsPageAttention = (pageId, config) => {
  if (
    pageId === "library" &&
    config &&
    !String(config.Library?.gameFolder || "").trim()
  ) {
    return "Choose a games folder";
  }
  return "";
};

const SettingsPanel = ({
  initialPage = "general",
  pageRequest = 0,
  onRunSetup,
  onScanNow,
  isScanRunning = false,
}) => {
  const [selected, setSelected] = React.useState(initialPage);
  const settings = window.settingsKit.useAppSettings();
  const appInfo = window.settingsKit.useAppInfo();
  const contentRef = React.useRef(null);

  React.useEffect(() => {
    if (SETTINGS_PAGES.some((page) => page.id === initialPage)) {
      setSelected(initialPage);
    }
  }, [initialPage, pageRequest]);

  React.useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [selected]);

  const page =
    SETTINGS_PAGES.find((entry) => entry.id === selected) || SETTINGS_PAGES[0];
  const pageSettings = {
    ...settings,
    onRestart: () => window.electronAPI.relaunchApp?.(),
  };

  const renderPage = () => {
    if (!settings.config) {
      return (
        <div className="space-y-3">
          <div className="h-24 animate-pulse bg-secondary/40" />
          <div className="h-40 animate-pulse bg-secondary/30" />
        </div>
      );
    }

    switch (page.id) {
      case "general":
        return (
          <window.GeneralSettings
            settings={pageSettings}
            onRunSetup={onRunSetup}
          />
        );
      case "library":
        return (
          <window.LibrarySettings
            settings={pageSettings}
            appInfo={appInfo}
            onScanNow={onScanNow}
            isScanRunning={isScanRunning}
          />
        );
      case "cloud":
        return <window.CloudSync />;
      case "notifications":
        return <window.NotificationSettings settings={pageSettings} />;
      case "appearance":
        return <window.AppearanceSettings settings={pageSettings} />;
      case "emulators":
        return <window.EmulatorLauncher />;
      case "about":
        return (
          <window.AboutSettings settings={pageSettings} appInfo={appInfo} />
        );
      default:
        return null;
    }
  };

  const renderNavItem = (item) => {
    const isActive = item.id === page.id;
    const attention = getSettingsPageAttention(item.id, settings.config);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => setSelected(item.id)}
          aria-current={isActive ? "page" : undefined}
          title={attention || item.label}
          className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left text-[13px] transition-colors ${
            isActive
              ? "border-l-accent bg-selected text-text"
              : "border-l-transparent text-text/75 hover:bg-white/5 hover:text-text"
          }`}
        >
          <span
            className={`material-symbols-outlined text-[20px] leading-none ${
              isActive ? "text-accent" : "text-text/55"
            }`}
          >
            {item.icon}
          </span>
          <span className="flex-1">{item.label}</span>
          {attention && (
            <span className="h-2 w-2 shrink-0 bg-amber-400 shadow-glow-glam" />
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full w-full text-[13px]">
      <nav className="w-[230px] shrink-0 overflow-y-auto border-r border-border bg-primary/50 pb-4">
        <div className="px-4 pb-3 pt-5 text-[11px] uppercase tracking-[0.18em] text-text/55">
          Settings
        </div>
        <ul>
          {SETTINGS_PAGES.filter((item) => !item.group).map(renderNavItem)}
        </ul>
        <div className="mx-4 my-3 h-px bg-border/70" />
        <ul>
          {SETTINGS_PAGES.filter((item) => item.group === "more").map(
            renderNavItem,
          )}
        </ul>
      </nav>
      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 pb-10 pt-6">
          <header className="mb-5 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-semibold text-text">{page.label}</h2>
              <p className="mt-1 text-sm text-text/60">{page.description}</p>
            </div>
            <window.SettingsSaveIndicator saveState={settings.saveState} />
          </header>
          {renderPage()}
        </div>
      </div>
    </div>
  );
};

window.SettingsPanel = SettingsPanel;
