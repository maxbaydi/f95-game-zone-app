const Notifications = () => {
  const [appUpdates, setAppUpdates] = React.useState(true);
  const [libraryUpdates, setLibraryUpdates] = React.useState(true);

  React.useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const notificationSettings = config.Notifications || {};
      setAppUpdates(notificationSettings.appUpdates !== false);
      setLibraryUpdates(notificationSettings.libraryUpdates !== false);
    });
  }, []);

  const saveSettings = (updatedSettings) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = {
        ...config,
        Notifications: { ...config.Notifications, ...updatedSettings },
      };
      window.electronAPI.saveSettings(newConfig);
    });
  };

  const handleAppUpdatesChange = () => {
    const next = !appUpdates;
    setAppUpdates(next);
    saveSettings({ appUpdates: next });
  };

  const handleLibraryUpdatesChange = () => {
    const next = !libraryUpdates;
    setLibraryUpdates(next);
    saveSettings({ libraryUpdates: next });
  };

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="flex-1">App update notifications</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={appUpdates}
          onChange={handleAppUpdatesChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        Notify when a new app version is available or ready to install.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Library update notifications</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={libraryUpdates}
          onChange={handleLibraryUpdatesChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        Notify when library games have new versions after a metadata refresh.
      </p>
    </div>
  );
};

window.Notifications = Notifications;
