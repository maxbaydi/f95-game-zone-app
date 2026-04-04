const { session } = require("electron");

const F95_AUTH_PARTITION = "persist:f95-auth";
const F95_LOGIN_URL = "https://f95zone.to/login/";
const F95_SEARCH_URL = "https://f95zone.to/sam/latest_alpha/";
const F95_BASE_URL = "https://f95zone.to/";

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
  const existingWindows = BrowserWindow.getAllWindows().filter(
    (windowInstance) => windowInstance.__atlasF95LoginWindow === true,
  );

  if (existingWindows.length > 0) {
    existingWindows[0].focus();
    return existingWindows[0];
  }

  const loginWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 700,
    title: "F95 Login",
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: F95_AUTH_PARTITION,
    },
  });

  loginWindow.__atlasF95LoginWindow = true;

  if (process.defaultApp || appConfig?.Interface?.showDebugConsole) {
    loginWindow.webContents.openDevTools({ mode: "detach" });
  }

  loginWindow.once("ready-to-show", () => {
    loginWindow.show();
  });

  loginWindow.loadURL(F95_LOGIN_URL).catch((error) => {
    console.error("[f95.auth] Failed to load login window:", error);
  });

  return loginWindow;
}

module.exports = {
  F95_AUTH_PARTITION,
  F95_BASE_URL,
  F95_LOGIN_URL,
  F95_SEARCH_URL,
  clearF95Session,
  createF95LoginWindow,
  getF95AuthState,
  getF95Session,
};
