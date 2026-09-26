const { useState, useEffect } = window.React;

const Settings = () => {
  const [selected, setSelected] = useState("Interface");
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (typeof window.electronAPI?.onWindowStateChanged !== "function") {
      return undefined;
    }
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === "maximized");
    });
    return () => window.electronAPI.removeAllListeners?.("window-state-changed");
  }, []);

  return (
    <div className="flex h-screen font-sans text-[13px] bg-transparent -webkit-app-region-no-drag">
      {/* Drag Header*/}
      <div className="absolute left-0 top-0 w-full h-[50px] ml-[-90px] z-40 -webkit-app-region-drag" />
      {/* Window Controls */}
      <div className="flex absolute top-1 right-2 h-[70px]">
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-450 -webkit-app-region-no-drag"
        >
          <i className="fas fa-minus text-text"></i>
        </button>
        <button
          onClick={() => window.electronAPI.maximizeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-450"
        >
          <i
            className={
              isMaximized
                ? "fas fa-window-restore text-text"
                : "fas fa-window-maximize text-text"
            }
          ></i>
        </button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-450"
        >
          <i className="fas fa-times text-text"></i>
        </button>
      </div>
      {/* Main Content */}
      <div className="flex flex-1 border border-accent rounded-md overflow-hidden">
        {/* Settings Sidebar */}
        <div className="w-[180px] bg-primary h-full border-r border-border -webkit-app-region-no-drag">
          <div className="text-center text-accent font-bold text-md mt-4 mb-4 antialiased -webkit-app-region-drag">
            F95LAUNCHER
          </div>
          {window.SettingsNav ? (
            <window.SettingsNav selected={selected} onSelect={setSelected} />
          ) : null}
        </div>
        {/* Settings Content */}
        <div className="flex-1 bg-secondary p-4 overflow-y-auto">
          <div key={selected} className="atlas-view-enter">
            <h2 className="text-2xl font-bold mb-4 text-text">{selected}</h2>
            {window.SettingsSectionContent ? (
              <window.SettingsSectionContent name={selected} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

const root = window.ReactDOM.createRoot(document.getElementById("root"));
const SettingsRootBoundary = window.AtlasErrorBoundary;
root.render(
  SettingsRootBoundary ? (
    <SettingsRootBoundary name="settings-window" variant="screen">
      <Settings />
    </SettingsRootBoundary>
  ) : (
    <Settings />
  ),
);
