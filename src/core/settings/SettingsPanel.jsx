const SettingsPanel = () => {
  const [selected, setSelected] = React.useState("Interface");

  const renderContent = () => {
    switch (selected) {
      case "Interface":
        return <window.Interface />;
      case "Library":
        return <window.Library />;
      case "Scan Sources":
        return <window.ScanSources />;
      case "Platforms":
        return <window.Platforms />;
      case "Emulators":
        return <window.EmulatorLauncher />;
      case "Appearance":
        return <window.Appearance />;
      case "Metadata":
        return <window.Metadata />;
      case "Cloud Saves":
        return <window.CloudSync />;
      case "Notifications":
        return <window.Notifications />;
      default:
        return <div className="p-4 text-text">Select a settings category</div>;
    }
  };

  return (
    <div className="flex h-full w-full text-[13px]">
      <div className="w-[200px] shrink-0 overflow-y-auto border-r border-border bg-primary/50">
        <div className="px-4 pt-5 pb-3 text-[11px] uppercase tracking-[0.18em] text-text/55">
          Settings
        </div>
        <ul>
          {window.settingsIcons.map((item) => (
            <React.Fragment key={item.name}>
              <li
                className={`flex cursor-pointer items-center px-4 py-2 text-text transition-colors hover:bg-highlight ${selected === item.name ? "border-l-2 border-l-accent bg-selected" : "border-l-2 border-l-transparent"} ${item.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                onClick={() => !item.disabled && setSelected(item.name)}
              >
                <svg
                  className="mr-2 h-4 w-4 text-text"
                  fill="currentColor"
                  viewBox={item.viewBox}
                >
                  <path d={item.path} />
                </svg>
                <span>{item.name}</span>
              </li>
              {item.name === "Emulators" && (
                <hr className="mx-3 my-2 border-border" />
              )}
            </React.Fragment>
          ))}
        </ul>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="mb-4 text-2xl font-bold text-text">{selected}</h2>
        {renderContent()}
      </div>
    </div>
  );
};

window.SettingsPanel = SettingsPanel;
