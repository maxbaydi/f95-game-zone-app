const StandaloneSettingsWindow = () => {
  const [isMaximized, setIsMaximized] = React.useState(false);

  React.useEffect(() => {
    window.electronAPI.onWindowStateChanged?.((state) => {
      setIsMaximized(state === "maximized");
    });
  }, []);

  return (
    <div className="flex h-screen flex-col bg-canvas font-sans text-[13px] text-text">
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-primary [-webkit-app-region:drag]">
        <div className="px-4 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          F95Launcher Settings
        </div>
        <div className="ml-auto flex h-full [-webkit-app-region:no-drag]">
          <button
            type="button"
            aria-label="Minimize window"
            onClick={() => window.electronAPI.minimizeWindow()}
            className="flex w-11 items-center justify-center hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">
              remove
            </span>
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
            onClick={() => window.electronAPI.maximizeWindow()}
            className="flex w-11 items-center justify-center hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[16px] leading-none">
              {isMaximized ? "filter_none" : "crop_square"}
            </span>
          </button>
          <button
            type="button"
            aria-label="Close window"
            onClick={() => window.electronAPI.closeWindow()}
            className="flex w-11 items-center justify-center hover:bg-red-900/80"
          >
            <span className="material-symbols-outlined text-[18px] leading-none">
              close
            </span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <window.SettingsPanel />
      </div>
    </div>
  );
};

window.ReactDOM.createRoot(document.getElementById("root")).render(
  <StandaloneSettingsWindow />,
);
