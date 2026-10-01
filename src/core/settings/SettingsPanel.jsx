const SETTINGS_PAGES = [
  {
    id: "general",
    label: "General",
    icon: "tune",
    description: "Window and startup behaviour, what runs in the background, and the setup assistant.",
  },
  {
    id: "library",
    label: "Library & folders",
    icon: "folder_open",
    description:
      "Where games are installed and which folders are scanned for games you already have.",
  },
  {
    id: "saves",
    label: "Save storage",
    icon: "cloud_sync",
    description:
      "Keep your saves in your own cloud (OneDrive, Dropbox, Google Drive, a WebDAV server, an S3 bucket or your own Supabase project) and get them back on any PC.",
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
  const navRef = React.useRef(null);
  const [indicator, setIndicator] = React.useState({ top: 0, height: 0 });

  React.useEffect(() => {
    // Older callers still ask for the "cloud" page.
    const requested = initialPage === "cloud" ? "saves" : initialPage;
    if (SETTINGS_PAGES.some((page) => page.id === requested)) {
      setSelected(requested);
    }
  }, [initialPage, pageRequest]);

  React.useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [selected]);

  const page =
    SETTINGS_PAGES.find((entry) => entry.id === selected) || SETTINGS_PAGES[0];

  // The selection bar slides between categories instead of jumping.
  React.useLayoutEffect(() => {
    const active = navRef.current?.querySelector('[aria-current="page"]');
    if (active) {
      setIndicator({ top: active.offsetTop, height: active.offsetHeight });
    }
  }, [page.id]);
  const pageSettings = {
    ...settings,
    onRestart: () => window.electronAPI.relaunchApp?.(),
  };

  const renderPageContent = () => {
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
      case "saves":
        return <window.SaveStorageSettings />;
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

  const renderPage = () => {
    const Safe = window.AppSafe;
    return Safe ? (
      <Safe
        name={`settings:${page.id}`}
        title={`${page.label} settings failed to load`}
      >
        {renderPageContent()}
      </Safe>
    ) : (
      renderPageContent()
    );
  };

  const renderNavItem = (item, index) => {
    const isActive = item.id === page.id;
    const attention = getSettingsPageAttention(item.id, settings.config);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => setSelected(item.id)}
          aria-current={isActive ? "page" : undefined}
          title={attention || item.label}
          className={`app-list-enter group relative flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] outline-none transition-colors duration-500 focus-visible:bg-white/5 ${
            isActive
              ? "text-text"
              : "text-text/75 hover:bg-white/5 hover:text-text"
          }`}
          style={{ "--app-index": index }}
        >
          <span
            className={`material-symbols-outlined text-[20px] leading-none transition-[color,transform] duration-500 ${
              isActive
                ? "scale-110 text-accent"
                : "text-text/55 group-hover:translate-x-0.5"
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
        <div ref={navRef} className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 w-full border-l-2 border-l-accent bg-selected transition-[top,height] duration-600 ease-spring"
            style={{ top: indicator.top, height: indicator.height }}
          />
          <ul>
            {SETTINGS_PAGES.filter((item) => !item.group).map(renderNavItem)}
          </ul>
          <div className="mx-4 my-3 h-px bg-border/70" />
          <ul>
            {SETTINGS_PAGES.filter((item) => item.group === "more").map(
              (item, index) => renderNavItem(item, index + 5),
            )}
          </ul>
        </div>
      </nav>
      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <div
          key={page.id}
          className="app-view-enter mx-auto w-full max-w-4xl px-6 pb-10 pt-6"
        >
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
