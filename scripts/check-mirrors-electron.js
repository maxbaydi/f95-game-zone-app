/* eslint-disable no-console */
/**
 * check-mirrors inside Electron: the same checks as scripts/check-mirrors.js
 * but with the app's own session (Chromium network stack, cookies of the
 * `persist:f95-auth` partition, so the F95 login made inside F95Launcher is
 * reused) and the real "finish the step in the browser" flow: a mirror that
 * asks for a captcha / Cloudflare check opens in a window, the mirror is
 * re-resolved once the page lets us through, and a download started inside
 * the window is adopted and verified like any other.
 *
 * Usage (close F95Launcher first — the profile must not be shared):
 *   npm run check:mirrors:app -- [check-mirrors options] <url> ...
 *
 * Extra options:
 *   --user-data <dir>         Electron userData of the app (default: the app's)
 *   --no-browser-step         report ACTION_REQUIRED instead of opening windows
 *   --action-timeout <ms>     give up on a browser step after this (default 10 min)
 *
 * Every option of scripts/check-mirrors.js works too (--cookies imports the
 * F95 login into the app session, --file, --thread, --simulate-drop, ...).
 */
const path = require("path");
const { app, BrowserWindow, session: electronSession } = require("electron");

const ROOT = path.resolve(__dirname, "..");
const core = require("./check-mirrors");
const { createMirrorActionFlow } = require(path.join(ROOT, "src/main/f95/mirrorActionFlow"));
const { F95_AUTH_PARTITION } = require(path.join(ROOT, "src/main/f95/session"));
const { MirrorActionRequiredError } = require(path.join(ROOT, "src/main/f95/hosts/common"));
const { sanitizeDownloadFileName } = require(path.join(ROOT, "src/main/f95/transferOptions"));
const { createElectronResolverSession } = require(path.join(ROOT, "src/main/f95/electronSession"));

function takeOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return { value: fallback, argv };
  }
  const value = argv[index + 1];
  return { value, argv: [...argv.slice(0, index), ...argv.slice(index + 2)] };
}

function takeFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return { value: false, argv };
  }
  return { value: true, argv: [...argv.slice(0, index), ...argv.slice(index + 1)] };
}

/** Electron passes its own argv; keep only what follows the script path. */
function scriptArgv() {
  const argv = process.argv.slice(1);
  const scriptIndex = argv.findIndex((entry) => /check-mirrors-electron\.js$/i.test(entry));
  return argv.slice(scriptIndex >= 0 ? scriptIndex + 1 : 0).filter((entry) => entry !== "--");
}

/**
 * Wrap a BrowserWindow for createMirrorActionFlow (same adapter shape as the
 * app uses in main.js).
 */
function openActionWindow(url, hostLabel) {
  const navigationListeners = new Set();
  const closedListeners = new Set();
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    title: `${hostLabel}: finish the step in this window`,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: F95_AUTH_PARTITION,
    },
  });
  const notify = (info) => {
    for (const listener of [...navigationListeners]) {
      try {
        listener(info);
      } catch {
        // ignore
      }
    }
  };
  const forward = () => {
    if (window.isDestroyed()) {
      return;
    }
    notify({ url: window.webContents.getURL(), title: window.webContents.getTitle() });
  };
  window.webContents.on("did-navigate", forward);
  window.webContents.on("did-navigate-in-page", forward);
  window.webContents.on("did-finish-load", forward);
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(String(targetUrl || ""))) {
      window.loadURL(targetUrl).catch(() => {});
    }
    return { action: "deny" };
  });
  window.once("closed", () => {
    for (const listener of [...closedListeners]) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  });
  window.loadURL(url).catch((error) => console.warn("[action-window] load failed:", error.message));

  return {
    webContentsId: window.webContents.id,
    onNavigated(callback) {
      navigationListeners.add(callback);
      return () => navigationListeners.delete(callback);
    },
    onClosed(callback) {
      closedListeners.add(callback);
      return () => closedListeners.delete(callback);
    },
    close() {
      if (!window.isDestroyed()) {
        window.close();
      }
    },
    isOpen: () => !window.isDestroyed(),
  };
}

/**
 * Drive the browser-step flow for one link. Resolves with `{prepared}` when
 * the mirror resolves after the step, `{adopted}` when the user started the
 * download inside the window (file already saved to `outDir`), or rejects.
 */
function awaitBrowserStep({ actionUrl, hostLabel, resolveMirror, session, outDir, timeoutMs, log }) {
  return new Promise((resolve, reject) => {
    let flow = null;
    const onWillDownload = (event, item, webContents) => {
      if (!flow || !flow.matchesWebContents(webContents?.id)) {
        return;
      }
      flow.adoptDownload();
      const fileName = sanitizeDownloadFileName(item.getFilename() || "download.bin", "download.bin");
      const targetPath = path.join(outDir, fileName);
      item.setSavePath(targetPath);
      log(`adopted a download started in the window: ${fileName} ${item.getTotalBytes() || "?"} bytes`);
      item.on("updated", (updatedEvent, state) => {
        if (state === "progressing" && item.getTotalBytes() > 0) {
          process.stdout.write(
            `    ${Math.floor((item.getReceivedBytes() / item.getTotalBytes()) * 100)}% ${item.getReceivedBytes()} / ${item.getTotalBytes()}\r`,
          );
        }
      });
      item.once("done", (doneEvent, state) => {
        process.stdout.write("\n");
        session.removeListener("will-download", onWillDownload);
        if (state !== "completed") {
          reject(new Error(`the download started in the window was ${state}`));
          return;
        }
        resolve({
          adopted: {
            targetPath,
            fileName,
            totalBytes: item.getTotalBytes() || 0,
            receivedBytes: item.getReceivedBytes() || 0,
            mimeType: typeof item.getMimeType === "function" ? item.getMimeType() : "",
            finalUrl: item.getURL(),
          },
        });
      });
    };
    session.on("will-download", onWillDownload);

    flow = createMirrorActionFlow({
      actionUrl,
      hostLabel,
      timeoutMs,
      logger: console,
      openWindow: (url) => openActionWindow(url, hostLabel),
      resolveMirror,
      onStatus: (text) => log(text),
      onResolved: (prepared) => {
        session.removeListener("will-download", onWillDownload);
        resolve({ prepared });
      },
      onGaveUp: (error) => {
        session.removeListener("will-download", onWillDownload);
        reject(error);
      },
    });
    flow.start();
  });
}

async function importCookies(session, cookies) {
  let imported = 0;
  for (const cookie of cookies) {
    const url = `https://${cookie.domain.replace(/^\./, "")}${cookie.path || "/"}`;
    try {
      await session.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.hostOnly ? undefined : `.${cookie.domain.replace(/^\./, "")}`,
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        ...(cookie.expirationDate > 0 ? { expirationDate: cookie.expirationDate } : {}),
      });
      imported += 1;
    } catch (error) {
      console.warn(`[cookies] could not import ${cookie.name} for ${cookie.domain}: ${error.message}`);
    }
  }
  return imported;
}

async function main() {
  let argv = scriptArgv();
  const userData = takeOption(argv, "--user-data", "");
  argv = userData.argv;
  const noBrowserStep = takeFlag(argv, "--no-browser-step");
  argv = noBrowserStep.argv;
  const actionTimeout = takeOption(argv, "--action-timeout", "600000");
  argv = actionTimeout.argv;

  app.setPath(
    "userData",
    userData.value || path.join(app.getPath("appData"), "f95launcher"),
  );
  app.setAppUserModelId("com.maxbaydi.f95launcher.check");
  if (!app.requestSingleInstanceLock()) {
    console.error("F95Launcher (or another check) is running with this profile. Close it first.");
    return 3;
  }
  // The browser-step window is the only window; closing it must not quit.
  app.on("window-all-closed", () => {});
  await app.whenReady();

  const session = electronSession.fromPartition(F95_AUTH_PARTITION);
  const options = core.parseArgs(argv);
  const cookies = options.cookies ? core.loadCookies(options.cookies, options.cookieDomains) : [];
  if (cookies.length > 0) {
    console.log(`imported ${await importCookies(session, cookies)} cookie(s) into ${F95_AUTH_PARTITION}`);
    options.cookies = "";
  }
  const f95Cookies = await session.cookies.get({ url: "https://f95zone.to/" });
  console.log(
    `session: ${F95_AUTH_PARTITION} in ${app.getPath("userData")} (${f95Cookies.length} F95 cookies, logged in: ${f95Cookies.some((cookie) => cookie.name === "xf_user")}), user agent: ${session.getUserAgent()}`,
  );

  const code = await core.run(options, {
    // Cookies attached explicitly, manual redirects via net.request — the
    // same wrapper the app uses (see src/main/f95/electronSession.js).
    session: createElectronResolverSession(session),
    userAgent: session.getUserAgent(),
    hooks: noBrowserStep.value
      ? {}
      : {
          awaitBrowserStep: (input) =>
            awaitBrowserStep({
              ...input,
              session,
              timeoutMs: Number(actionTimeout.value) || 600000,
            }),
        },
  });
  return code;
}

main().then(
  (code) => {
    process.exitCode = code;
    app.quit();
  },
  (error) => {
    console.error("check-mirrors (electron) crashed:", error);
    process.exitCode = 1;
    app.quit();
  },
);

module.exports = { MirrorActionRequiredError, awaitBrowserStep, openActionWindow };
