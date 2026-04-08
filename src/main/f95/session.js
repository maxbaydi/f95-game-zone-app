const path = require("path");
const { session } = require("electron");

const F95_AUTH_PARTITION = "persist:f95-auth";
const F95_LOGIN_URL = "https://f95zone.to/login/";
const F95_SEARCH_URL = "https://f95zone.to/sam/latest_alpha/";
const F95_BASE_URL = "https://f95zone.to/";
const F95_WINDOW_ICON_PATH = path.join(
  __dirname,
  "..",
  "..",
  "assets",
  "images",
  "appicon.ico",
);

function getF95Session() {
  return session.fromPartition(F95_AUTH_PARTITION);
}

async function getF95AuthState(customSession = getF95Session()) {
  const cookies = await customSession.cookies.get({
    url: F95_BASE_URL,
  });

  const xfUserCookie = cookies.find(
    (cookie) =>
      cookie.name === "xf_user" && String(cookie.value || "").trim() !== "",
  );

  return {
    isAuthenticated: Boolean(xfUserCookie),
    cookieCount: cookies.length,
    loginUrl: F95_LOGIN_URL,
    searchUrl: F95_SEARCH_URL,
  };
}

async function clearF95Session(customSession = getF95Session()) {
  await customSession.clearStorageData();

  const cookies = await customSession.cookies.get({});
  await Promise.all(
    cookies.map((cookie) => {
      const removalUrl = `http${cookie.secure ? "s" : ""}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
      return customSession.cookies.remove(removalUrl, cookie.name);
    }),
  );

  try {
    await customSession.clearCache();
  } catch (error) {
    console.warn("[f95.auth] Failed to clear cache:", error);
  }

  return getF95AuthState(customSession);
}

function createF95LoginWindow({ BrowserWindow, appConfig }) {
  const loginWindow = createF95BrowserWindow({
    BrowserWindow,
    appConfig,
    url: F95_LOGIN_URL,
    title: "F95 Login",
    reuseKey: "__atlasF95LoginWindow",
  });

  return loginWindow;
}

function createF95BrowserWindow({
  BrowserWindow,
  appConfig,
  url,
  title = "F95 Browser",
  reuseKey = "__atlasF95BrowserWindow",
  onNavigation = null,
}) {
  const emitNavigation = (windowInstance) => {
    if (
      !windowInstance ||
      windowInstance.isDestroyed() ||
      typeof windowInstance.__atlasF95NavigationHandler !== "function"
    ) {
      return;
    }

    let currentUrl = "";
    let currentTitle = "";
    try {
      currentUrl = windowInstance.webContents.getURL();
      currentTitle = windowInstance.webContents.getTitle();
    } catch (error) {
      console.warn(
        "[f95.browser] Failed to read browser navigation state:",
        error,
      );
    }

    windowInstance.__atlasF95NavigationHandler({
      url: currentUrl,
      title: currentTitle,
    });
  };

  const existingWindow = BrowserWindow.getAllWindows().find(
    (windowInstance) => windowInstance[reuseKey] === true,
  );

  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow[reuseKey] = true;
    existingWindow.__atlasF95NavigationHandler =
      typeof onNavigation === "function" ? onNavigation : null;
    existingWindow.setTitle(title);
    existingWindow.loadURL(url).catch((error) => {
      console.error(
        "[f95.browser] Failed to reload F95 browser window:",
        error,
      );
    });
    existingWindow.focus();
    return existingWindow;
  }

  const browserWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 700,
    icon: F95_WINDOW_ICON_PATH,
    title,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: F95_AUTH_PARTITION,
    },
  });

  browserWindow[reuseKey] = true;
  browserWindow.__atlasF95NavigationHandler =
    typeof onNavigation === "function" ? onNavigation : null;

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    browserWindow.webContents.openDevTools({ mode: "detach" });
  }

  browserWindow.once("ready-to-show", () => {
    browserWindow.show();
  });

  if (!browserWindow.__atlasF95BrowserWindowConfigured) {
    browserWindow.__atlasF95BrowserWindowConfigured = true;
    browserWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (/^https?:\/\//i.test(String(targetUrl || ""))) {
        browserWindow.loadURL(targetUrl).catch((error) => {
          console.error("[f95.browser] Failed to open popup target:", error);
        });
      }

      return { action: "deny" };
    });

    const forwardNavigationState = () => {
      emitNavigation(browserWindow);
    };

    browserWindow.webContents.on("did-navigate", forwardNavigationState);
    browserWindow.webContents.on("did-navigate-in-page", forwardNavigationState);
    browserWindow.webContents.on("page-title-updated", forwardNavigationState);
    browserWindow.webContents.on("did-finish-load", forwardNavigationState);
    browserWindow.on("closed", () => {
      browserWindow.__atlasF95NavigationHandler = null;
    });
  }

  browserWindow.loadURL(url).catch((error) => {
    console.error("[f95.browser] Failed to load browser window:", error);
  });

  return browserWindow;
}

module.exports = {
  F95_AUTH_PARTITION,
  F95_BASE_URL,
  F95_LOGIN_URL,
  F95_SEARCH_URL,
  clearF95Session,
  createF95BrowserWindow,
  createF95LoginWindow,
  getF95AuthState,
  getF95Session,
};
