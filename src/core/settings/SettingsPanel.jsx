const SETTINGS_SECTIONS = {
  Interface: () => <window.Interface />,
  Library: () => <window.Library />,
  "Scan Sources": () => <window.ScanSources />,
  Platforms: () => <window.Platforms />,
  Emulators: () => <window.EmulatorLauncher />,
  Appearance: () => <window.Appearance />,
  Metadata: () => <window.Metadata />,
  "Cloud Saves": () => <window.CloudSync />,
  Notifications: () => <window.Notifications />,
};

const SettingsSectionContent = ({ name }) => {
  const renderSection = SETTINGS_SECTIONS[name];
  if (!renderSection) {
    return <div className="p-4 text-text">Select a settings category</div>;
  }

  const Safe = window.AtlasSafe;
  return Safe ? (
    <Safe name={`settings:${name}`} title={`${name} settings failed to load`}>
      {renderSection()}
    </Safe>
  ) : (
    renderSection()
  );
};

// Category list with a sliding selection bar; shared by the embedded settings
// section and the standalone settings window.
const SettingsNav = ({ selected, onSelect, className = "" }) => {
  const items = window.settingsIcons || [];
  const listRef = React.useRef(null);
  const [indicator, setIndicator] = React.useState({ top: 0, height: 0 });

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector('[aria-selected="true"]');
    if (active) {
      setIndicator({ top: active.offsetTop, height: active.offsetHeight });
    }
  }, [selected, items.length]);

  const focusSibling = (event, direction) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll('[role="tab"]:not([disabled])') || [],
    );
    const index = buttons.indexOf(event.currentTarget);
    const next = buttons[(index + direction + buttons.length) % buttons.length];
    if (next) {
      event.preventDefault();
      next.focus();
      next.click();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="vertical"
      className={`relative ${className}`}
    >
      <span
        aria-hidden
        className="absolute left-0 w-full border-l-2 border-l-accent bg-selected transition-[top,height] duration-600 ease-spring"
        style={{ top: indicator.top, height: indicator.height }}
      />
      {items.map((item, index) => (
        <React.Fragment key={item.name}>
          <button
            type="button"
            role="tab"
            aria-selected={selected === item.name}
            disabled={item.disabled}
            onClick={() => !item.disabled && onSelect(item.name)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") focusSibling(event, 1);
              if (event.key === "ArrowUp") focusSibling(event, -1);
            }}
            className={`atlas-list-enter group relative flex w-full items-center px-4 py-2 text-left text-text outline-none transition-colors duration-500 hover:bg-highlight/60 focus-visible:bg-highlight/60 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected === item.name ? "font-semibold" : ""
            }`}
            style={{ "--atlas-index": index }}
          >
            <svg
              className={`mr-2 h-4 w-4 transition-[color,transform] duration-500 ${
                selected === item.name
                  ? "scale-110 text-accent"
                  : "text-text group-hover:translate-x-0.5"
              }`}
              fill="currentColor"
              viewBox={item.viewBox}
              aria-hidden
            >
              <path d={item.path} />
            </svg>
            <span>{item.name}</span>
          </button>
          {item.name === "Emulators" && <hr className="mx-3 my-2 border-border" />}
        </React.Fragment>
      ))}
    </div>
  );
};

window.SettingsNav = SettingsNav;
window.SettingsSectionContent = SettingsSectionContent;

const SettingsPanel = () => {
  const [selected, setSelected] = React.useState("Interface");

  return (
    <div className="flex h-full w-full text-[13px]">
      <div className="w-[200px] shrink-0 overflow-y-auto border-r border-border bg-primary/50">
        <div className="px-4 pt-5 pb-3 text-[11px] uppercase tracking-[0.18em] text-text/55">
          Settings
        </div>
        <SettingsNav selected={selected} onSelect={setSelected} />
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div key={selected} className="atlas-view-enter">
          <h2 className="mb-4 text-2xl font-bold text-text">{selected}</h2>
          <SettingsSectionContent name={selected} />
        </div>
      </div>
    </div>
  );
};

window.SettingsPanel = SettingsPanel;
