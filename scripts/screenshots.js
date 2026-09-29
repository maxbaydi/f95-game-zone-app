#!/usr/bin/env node
/**
 * Marketing screenshots of the renderer, taken from the browser preview in
 * demo mode (`src/index.html?demo=1`, see src/web-preview-api.js).
 *
 *   npm run screenshots
 *
 * Serves `src/` on a local port, opens the app in headless Chromium through
 * Playwright and writes PNGs (1600×1000, device scale factor 1) to
 * docs/screenshots/. Options (environment variables):
 *
 *   SCREENSHOT_PORT        port for the static server (default 5199)
 *   SCREENSHOT_OUT_DIR     output folder (default docs/screenshots)
 *   SCREENSHOT_ONLY        comma-separated shot ids to (re)capture
 *   PLAYWRIGHT_CHROMIUM    path to a Chromium/Chrome binary; when it is not
 *                          set the script uses Playwright's own browser, the
 *                          first build found in PLAYWRIGHT_BROWSERS_PATH, or
 *                          a Chrome/Edge/Chromium/Brave installed on the PC
 *
 * Playwright is not a project dependency: install it after each `npm ci`
 * with `npm install --no-save playwright-core` (no browser download).
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const PORT = Number.parseInt(process.env.SCREENSHOT_PORT || "5199", 10);
const OUT_DIR = path.resolve(
  ROOT,
  process.env.SCREENSHOT_OUT_DIR || path.join("docs", "screenshots"),
);
const VIEWPORT = { width: 1600, height: 1000 };
const BASE_URL = `http://127.0.0.1:${PORT}/index.html`;
const ONLY = new Set(
  String(process.env.SCREENSHOT_ONLY || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

// Cards, dialogs and lists animate in; the renderer's motion system reads
// this key at start-up and turns every animation into a 1 ms no-op.
const INIT_SCRIPT = `
  try {
    localStorage.setItem("atlas-motion", "off");
    localStorage.setItem("atlas-library-details-panel-width", "520");
  } catch (_) {}
`;
const HIDE_CURSOR_CSS = `
  *, *::before, *::after { cursor: none !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`;

const log = (message) => console.log(`[screenshots] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return require(name);
    } catch (_) {
      /* try the next package */
    }
  }
  throw new Error(
    "Playwright is not installed. Run `npm install --no-save playwright-core` first (no browser download needed: an installed Chrome or Edge is used).",
  );
}

// A Chromium binary for Playwright: an explicit path, or a build inside
// PLAYWRIGHT_BROWSERS_PATH (Playwright itself only accepts the exact
// revision it was released with).
function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM) {
    return process.env.PLAYWRIGHT_CHROMIUM;
  }
  const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersDir || !fs.existsSync(browsersDir)) {
    return findSystemBrowser();
  }
  const candidates = fs
    .readdirSync(browsersDir)
    .filter((entry) => /^chromium(_headless_shell)?-\d+$/.test(entry))
    .sort((left, right) => {
      const headlessDelta =
        Number(right.includes("headless")) - Number(left.includes("headless"));
      if (headlessDelta !== 0) {
        return headlessDelta;
      }
      return right.localeCompare(left, undefined, { numeric: true });
    });
  for (const candidate of candidates) {
    for (const binary of [
      path.join(browsersDir, candidate, "chrome-linux", "headless_shell"),
      path.join(browsersDir, candidate, "chrome-linux", "chrome"),
      path.join(browsersDir, candidate, "chrome-win", "chrome.exe"),
      path.join(
        browsersDir,
        candidate,
        "chrome-mac",
        "Chromium.app",
        "Contents",
        "MacOS",
        "Chromium",
      ),
    ]) {
      if (fs.existsSync(binary)) {
        return binary;
      }
    }
  }
  return findSystemBrowser();
}

// Chrome or Edge already installed on the machine, so nothing has to be
// downloaded (Playwright's CDN is slow or blocked in some regions).
function findSystemBrowser() {
  const candidates = [];
  if (process.platform === "win32") {
    const roots = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(root, "Chromium", "Application", "chrome.exe"),
        path.join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium",
    );
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function launchBrowser(chromium) {
  const executablePath = findChromiumExecutable();
  const options = { headless: true };
  try {
    return await chromium.launch(options);
  } catch (error) {
    if (!executablePath) {
      throw error;
    }
    log(`Playwright's own Chromium is unavailable, using ${executablePath}`);
    return chromium.launch({ ...options, executablePath });
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Serves `src/` as-is (no clean-URL redirects, so `index.html?demo=1` keeps
// its query string). Same files as `npm run dev:web`.
function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(SRC, relative || "index.html");
    if (!file.startsWith(SRC + path.sep) && file !== SRC) {
      response.writeHead(403);
      response.end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function openApp(context, query) {
  const page = await context.newPage();
  page.on("pageerror", (error) => log(`page error: ${error.message}`));
  await page.goto(`${BASE_URL}?${query}`, { waitUntil: "load" });
  await page.addStyleTag({ content: HIDE_CURSOR_CSS });
  // The boot overlay is removed once the React tree has rendered.
  await page.waitForSelector("#atlas-boot", { state: "detached", timeout: 60000 });
  await page.waitForSelector(".atlas-app", { timeout: 60000 });
  return page;
}

// Keeps the pointer off every hoverable control between clicks.
async function parkMouse(page) {
  await page.mouse.move(VIEWPORT.width - 260, 35);
}

async function settle(page, ms = 700) {
  await parkMouse(page);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await sleep(ms);
}

async function capture(page, id, description) {
  const file = path.join(OUT_DIR, `${id}.png`);
  await settle(page);
  await page.screenshot({ path: file, type: "png", fullPage: false });
  log(`${path.relative(ROOT, file)} — ${description}`);
}

const wants = (id) => ONLY.size === 0 || ONLY.has(id);

async function closeDetailsPanel(page) {
  const close = page.locator('aside[aria-label="Game details"] button[aria-label="Close details"]');
  if (await close.count()) {
    await close.first().click();
    await page.waitForSelector('aside[aria-label="Game details"]', {
      state: "detached",
      timeout: 10000,
    });
  }
}

async function shootLibraryViews(context) {
  const page = await openApp(context, "demo=1");
  await page.waitForSelector(".banner-root", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".banner-root").length >= 11,
    null,
    { timeout: 30000 },
  );
  // Banners are inline SVG data URIs; give the images a moment to decode.
  await sleep(500);

  if (wants("01-library-grid")) {
    await capture(
      page,
      "01-library-grid",
      "library grid with cover art, favorites, update and files-missing badges",
    );
  }

  if (wants("02-game-details-saves")) {
    await page
      .locator('.banner-root[aria-label^="Harbor Lights"]')
      .first()
      .click();
    const panel = page.locator('aside[aria-label="Game details"]');
    await panel.waitFor({ timeout: 15000 });
    await page.waitForSelector(
      'aside[aria-label="Game details"] :text("save locations found")',
      { timeout: 15000 },
    );
    // Scroll the Saves block (LibrarySaveSyncPanel) to the top of the panel;
    // the cached screenshots follow below it.
    await page.evaluate(() => {
      const panel = document.querySelector('aside[aria-label="Game details"]');
      const target = Array.from(panel.querySelectorAll("section")).find((node) =>
        /^Saves/.test(node.textContent.trim()),
      );
      target?.scrollIntoView({ block: "start" });
    });
    await capture(
      page,
      "02-game-details-saves",
      "game details panel: installed version vs. thread version, and the Saves block with cloud backup",
    );
    await closeDetailsPanel(page);
  }

  if (wants("03-downloads-panel")) {
    await page.getByRole("button", { name: /Downloads/ }).last().click();
    const dialog = page.locator('div[role="dialog"][aria-label="Downloads"]');
    await dialog.waitFor({ timeout: 15000 });
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Downloads"] :text("The archive needs a password")',
      { timeout: 15000 },
    );
    await capture(
      page,
      "03-downloads-panel",
      "downloads panel: installing, installed, password-protected archive and out-of-disk-space recovery",
    );
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
  }

  if (wants("04-scan-hub")) {
    await page.getByRole("button", { name: /Scan Hub/ }).click();
    const dialog = page.locator('div[role="dialog"][aria-label="Scan Hub"]');
    await dialog.waitFor({ timeout: 15000 });
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Scan Hub"] :text("Frostpeak Chronicles")',
      { timeout: 15000 },
    );
    await capture(
      page,
      "04-scan-hub",
      "Scan Hub: rescan modes, scan sources, recent jobs and the discovery queue",
    );
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
  }

  if (wants("05-updates-inbox")) {
    await page.locator('nav[aria-label="Sections"] button[aria-label="Updates"]').click();
    await page.waitForSelector(':text("Update Titles")', { timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelectorAll(".banner-root").length >= 3,
      null,
      { timeout: 15000 },
    );
    await capture(
      page,
      "05-updates-inbox",
      "Updates inbox: installed games with a newer version on their F95 thread",
    );
  }

  if (wants("06-settings-save-storage") || wants("07-settings-library-folders")) {
    await page.locator('nav[aria-label="Sections"] button[aria-label="Settings"]').click();
    await page.waitForSelector('button[aria-current="page"]', { timeout: 15000 });

    if (wants("06-settings-save-storage")) {
      await page.getByRole("button", { name: "Save storage" }).click();
      await page.waitForSelector(':text("Connected: OneDrive")', { timeout: 15000 });
      await page.waitForSelector(':text("Quiet Meadows")', { timeout: 15000 });
      await capture(
        page,
        "06-settings-save-storage",
        "Settings → Save storage: connected OneDrive folder and the backups catalog",
      );
    }

    if (wants("07-settings-library-folders")) {
      await page.getByRole("button", { name: "Library & folders" }).click();
      await page.waitForSelector(':text("Included in library scans")', { timeout: 15000 });
      await page.waitForSelector(':text("Library backups")', { timeout: 15000 });
      await capture(
        page,
        "07-settings-library-folders",
        "Settings → Library & folders: install folder health, scan folders, detected folders and backups",
      );
    }
  }

  await page.close();
}

async function shootOnboarding(context) {
  if (!wants("08-onboarding-saves")) {
    return;
  }
  const page = await openApp(context, "demo=1&onboarding=saves");
  const dialog = page.locator('div[role="dialog"][aria-label="F95Launcher setup"]');
  await dialog.waitFor({ timeout: 30000 });

  // welcome → folder
  await dialog.getByRole("button", { name: "Get started" }).click();
  await dialog.locator(':text("Where should games be installed?")').waitFor({ timeout: 15000 });
  // folder → your games (the button is disabled while the folder is checked)
  const useFolder = dialog.getByRole("button", { name: /Use this folder|Continue/ });
  await useFolder.waitFor({ timeout: 15000 });
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(
        (node) => /Use this folder|Continue/.test(node.textContent),
      );
      return button && !button.disabled;
    },
    null,
    { timeout: 15000 },
  );
  await useFolder.click();
  await dialog.locator(':text("Do you already have games on this PC?")').waitFor({ timeout: 15000 });
  // your games → saves
  await dialog.getByRole("button", { name: "Not now" }).click();
  await dialog.locator(':text("Where should your saves live?")').waitFor({ timeout: 15000 });
  await dialog.locator(':text("Google Drive")').first().waitFor({ timeout: 15000 });
  await capture(
    page,
    "08-onboarding-saves",
    "first-launch assistant, Saves step: detected OneDrive / Dropbox / Google Drive folders",
  );
  await page.close();
}

async function shootF95Browser(context) {
  if (!wants("09-f95-browser")) {
    return;
  }
  const page = await openApp(context, "demo=1&f95=thread");
  await page.locator('nav[aria-label="Sections"] button[aria-label="Search"]').click();
  const toolbar = page.locator('[role="toolbar"][aria-label="F95 browser"]');
  await toolbar.waitFor({ timeout: 30000 });
  await toolbar.getByRole("button", { name: "In library", exact: true }).waitFor({ timeout: 15000 });
  // The demo emits one "downloading" progress event for the transfer chip.
  await toolbar.locator(':text("Downloading 62%")').waitFor({ timeout: 15000 });
  // Install → the demo mirror answers with a verification step, which shows
  // the compact floating note over the page.
  await toolbar.getByRole("button", { name: "Install", exact: true }).click();
  await page.locator('[data-notice="captcha"]').waitFor({ timeout: 15000 });
  await capture(
    page,
    "09-f95-browser",
    "F95 browser: compact toolbar, library badge, transfer chip and a floating note",
  );
  await page.close();
}

async function main() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await startServer();
  let browser = null;
  try {
    log(`preview served from ${BASE_URL}`);

    browser = await launchBrowser(chromium);
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: "dark",
      locale: "en-US",
      timezoneId: "Europe/Berlin",
    });
    await context.addInitScript(INIT_SCRIPT);

    await shootLibraryViews(context);
    await shootOnboarding(context);
    await shootF95Browser(context);
    log("done");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.close();
  }
}

main().catch((error) => {
  console.error("[screenshots] failed:", error);
  process.exitCode = 1;
});
