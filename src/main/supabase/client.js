const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_STORAGE_BUCKET = "atlas-cloud-saves";

function parseBoolean(value, fallbackValue) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }

    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  return fallbackValue;
}

function resolveSupabaseSettings(config) {
  const cloudSync = config?.CloudSync || {};
  const projectRef = String(cloudSync.projectRef || "").trim();
  const url =
    String(cloudSync.supabaseUrl || "").trim() ||
    (projectRef ? `https://${projectRef}.supabase.co` : "");
  const publishableKey = String(cloudSync.publishableKey || "").trim();
  const storageBucket =
    String(cloudSync.storageBucket || "").trim() || DEFAULT_STORAGE_BUCKET;
  const enabled = parseBoolean(cloudSync.enabled, true);

  return {
    enabled,
    url,
    publishableKey,
    storageBucket,
    projectRef,
    isConfigured: Boolean(enabled && url && publishableKey),
  };
}

function createFileStorage(sessionFilePath) {
  const ensureParent = () => {
    fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
  };

  return {
    getItem(key) {
      try {
        ensureParent();
        if (!fs.existsSync(sessionFilePath)) {
          return null;
        }

        const payload = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
        return typeof payload?.[key] === "string" ? payload[key] : null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      ensureParent();
      let payload = {};
      try {
        if (fs.existsSync(sessionFilePath)) {
          payload = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
        }
      } catch {
        payload = {};
      }

      payload[key] = value;
      fs.writeFileSync(sessionFilePath, JSON.stringify(payload, null, 2), "utf8");
    },
    removeItem(key) {
      try {
        if (!fs.existsSync(sessionFilePath)) {
          return;
        }

        const payload = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
        delete payload[key];
        fs.writeFileSync(sessionFilePath, JSON.stringify(payload, null, 2), "utf8");
      } catch {
        // Ignore session cleanup failures.
      }
    },
  };
}

function buildSessionFilePath(appPaths, settings) {
  const keySource = settings.projectRef || settings.url || "default";
  const suffix = crypto
    .createHash("sha1")
    .update(keySource)
    .digest("hex")
    .slice(0, 12);

  return path.join(appPaths.data, `supabase-session-${suffix}.json`);
}

function createSupabaseDesktopClient(appPaths, config) {
  const settings = resolveSupabaseSettings(config);
  if (!settings.isConfigured) {
    return {
      client: null,
      settings,
    };
  }

  const sessionFilePath = buildSessionFilePath(appPaths, settings);
  const storage = createFileStorage(sessionFilePath);
  const client = createClient(settings.url, settings.publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storage,
    },
  });

  return {
    client,
    settings,
    sessionFilePath,
  };
}

module.exports = {
  DEFAULT_STORAGE_BUCKET,
  createSupabaseDesktopClient,
  resolveSupabaseSettings,
};
