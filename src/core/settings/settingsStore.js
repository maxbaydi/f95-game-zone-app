// Shared settings persistence for the settings panels (main window and the
// standalone settings window). Saves are serialized so quick successive
// toggles cannot interleave their read-modify-write cycles and drop changes.
(function () {
  "use strict";

  if (window.AtlasSettings) {
    return;
  }

  var queue = Promise.resolve();

  function toast() {
    return window.AtlasToast || null;
  }

  function describe(error, fallback) {
    return window.AtlasUI
      ? window.AtlasUI.errorMessage(error, fallback)
      : (error && error.message) || fallback;
  }

  function load() {
    var api = window.electronAPI;
    if (!api || typeof api.getConfig !== "function") {
      return Promise.resolve({});
    }
    return Promise.resolve()
      .then(function () {
        return api.getConfig();
      })
      .then(function (config) {
        return config && typeof config === "object" ? config : {};
      })
      .catch(function (error) {
        console.error("[settings] Failed to load config:", error);
        var t = toast();
        if (t) {
          t.error(describe(error, "Settings could not be loaded."), {
            id: "atlas-settings-load",
            title: "Settings",
          });
        }
        return {};
      });
  }

  function save(section, patch, options) {
    var opts = options || {};
    var task = queue.then(function () {
      var api = window.electronAPI;
      if (!api || typeof api.saveSettings !== "function") {
        throw new Error("Settings cannot be saved in this window.");
      }
      return Promise.resolve(api.getConfig()).then(function (config) {
        var current = config && typeof config === "object" ? config : {};
        var next = Object.assign({}, current);
        next[section] = Object.assign({}, current[section] || {}, patch);
        return Promise.resolve(api.saveSettings(next)).then(function (result) {
          if (result && result.success === false) {
            throw new Error(result.error || "Settings could not be saved.");
          }
          return next;
        });
      });
    });

    queue = task.catch(function () {});

    return task.then(
      function (next) {
        var t = toast();
        if (t && !opts.silent) {
          t.show({
            id: "atlas-settings-saved",
            type: "success",
            message: opts.message || "Settings saved.",
            duration: 1800,
          });
        }
        return next;
      },
      function (error) {
        console.error("[settings] Failed to save " + section + ":", error);
        var t = toast();
        if (t) {
          t.error(describe(error, "Settings could not be saved."), {
            title: "Settings",
          });
        }
        throw error;
      },
    );
  }

  window.AtlasSettings = { load: load, save: save };
})();
