const Notifications = () => {
  const [appUpdates, setAppUpdates] = React.useState(true);
  const [libraryUpdates, setLibraryUpdates] = React.useState(true);
  const Row = window.SettingsRow;
  const Toggle = window.SettingsToggle;

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
        const notificationSettings = config?.Notifications || {};
        setAppUpdates(
          notificationSettings.appUpdates !== false &&
            notificationSettings.appUpdates !== "false",
        );
        setLibraryUpdates(
          notificationSettings.libraryUpdates !== false &&
            notificationSettings.libraryUpdates !== "false",
        );
      })
      .catch((error) =>
        console.error("Failed to load notification settings:", error),
      );
    return () => {
      active = false;
    };
  }, []);

  const saveSettings = (updatedSettings) =>
    window.AtlasSettings
      ? window.AtlasSettings.save("Notifications", updatedSettings)
      : window.electronAPI.getConfig().then((config) =>
          window.electronAPI.saveSettings({
            ...config,
            Notifications: { ...config.Notifications, ...updatedSettings },
          }),
        );

  const handleAppUpdatesChange = (next) => {
    setAppUpdates(next);
    saveSettings({ appUpdates: next }).catch(() => setAppUpdates(!next));
  };

  const handleLibraryUpdatesChange = (next) => {
    setLibraryUpdates(next);
    saveSettings({ libraryUpdates: next }).catch(() =>
      setLibraryUpdates(!next),
    );
  };

  if (!Row || !Toggle) {
    return null;
  }

  return (
    <div className="p-5 text-text">
      <Row
        index={0}
        title="App update notifications"
        description="Notify when a new app version is available or ready to install."
      >
        <Toggle
          label="App update notifications"
          checked={appUpdates}
          onChange={handleAppUpdatesChange}
        />
      </Row>
      <Row
        index={1}
        title="Library update notifications"
        description="Notify when library games have new versions after a metadata refresh."
      >
        <Toggle
          label="Library update notifications"
          checked={libraryUpdates}
          onChange={handleLibraryUpdatesChange}
        />
      </Row>
    </div>
  );
};

window.Notifications = Notifications;
