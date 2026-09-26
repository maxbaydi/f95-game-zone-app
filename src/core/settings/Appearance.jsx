const { useState, useEffect } = window.React;

const Appearance = () => {
  const [theme, setTheme] = useState("Default");
  const [banner, setBanner] = useState("Default");
  const [availableTemplates, setAvailableTemplates] = useState(["Default"]);

  useEffect(() => {
    // Fetch available templates from data/templates/banner
    const loadTemplates = async () => {
      try {
        const templates =
          await window.electronAPI.getAvailableBannerTemplates();
        setAvailableTemplates(["Default", ...templates]);
      } catch (err) {
        console.error("Error fetching banner templates:", err);
        window.electronAPI.log(
          `Error fetching banner templates: ${err.message}`,
        );
      }
    };
    loadTemplates();
  }, []);

  const handleLoadTheme = () => {
    window.AtlasToast?.success("Theme applied and saved.", { title: "Appearance" });
  };

  const handleLoadBanner = async () => {
    try {
      await window.electronAPI.setSelectedBannerTemplate(banner);
      window.AtlasToast?.success("Banner layout saved. It applies the next time the library window loads.", { title: "Appearance" });
    } catch (err) {
      console.error("Error loading banner template:", err);
      window.electronAPI.log(`Error loading banner template: ${err.message}`);
      window.AtlasToast?.error(err?.message || "The banner template could not be loaded.", { title: "Appearance" });
    }
  };

  const handleOpenXamlEditor = () => {
    window.AtlasToast?.info("The XAML editor is not available in this version yet.", { title: "Appearance" });
  };

  return (
    <div className="p-5 text-text -webkit-app-region-no-drag">
      <div className="flex items-center mb-2">
        <label className="flex-1">Select a Theme:</label>
        <div className="flex items-center">
          <select
            className="w-80 bg-secondary border border-border text-text rounded p-1"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option>Default</option>
          </select>
          <button
            className="ml-5 rounded bg-accent px-4 py-1 text-onAccent hover:brightness-110"
            onClick={handleLoadTheme}
          >
            Load
          </button>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Default app theme. Changes are saved as soon as a theme file is loaded
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Select a Banner UI Resource:</label>
        <div className="flex items-center">
          <select
            className="w-80 bg-secondary border border-border text-text rounded p-1"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
          >
            {availableTemplates.map((template) => (
              <option key={template} value={template}>
                {template}
              </option>
            ))}
          </select>
          <button
            className="ml-5 rounded bg-accent px-4 py-1 text-onAccent hover:brightness-110"
            onClick={handleLoadBanner}
          >
            Load
          </button>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-2">
        This will override the default banner layout. Please check for errors
        prior to loading
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Open Xaml Editor</label>
        <button
          className="ml-5 rounded bg-accent px-4 py-1 text-onAccent hover:brightness-110"
          onClick={handleOpenXamlEditor}
        >
          Launch
        </button>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Create and modify existing banner themes
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

window.Appearance = Appearance;
