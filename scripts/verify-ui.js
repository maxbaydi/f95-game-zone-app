// Browser QA on disposable demo data. Like scripts/screenshots.js, this uses
// an optional Playwright installation, not a shipped application dependency.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("playwright-core"); }

const base = process.env.UI_QA_URL || "http://127.0.0.1:5173";
const out = path.resolve(process.env.UI_QA_OUT_DIR || "output/playwright/ui-review");
fs.mkdirSync(out, { recursive: true });
const results = [];
const errors = [];

async function run() {
  const browser = await playwright.chromium.launch({ channel: process.env.UI_QA_BROWSER || "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 680 } });
  await context.addInitScript(() => { try { localStorage.setItem("app-motion", "off"); } catch { /* sandboxed preview frames */ } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async (query = "demo=1", pathname = "/") => {
    await page.goto(`${base}${pathname}?${query}`);
    await page.waitForFunction(() => window.AppUI?.boot?.isReady?.());
  };
  const inspect = async (name) => {
    const clipped = await page.evaluate(() => Array.from(document.querySelectorAll("button,input,select"))
      .filter((element) => {
        if (element.closest("[inert]")) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.top < innerHeight && box.bottom > 0 && (box.right > innerWidth + 1 || box.left < -1);
      }).map((element) => element.getAttribute("aria-label") || element.textContent));
    assert.deepEqual(clipped, [], `${name}: controls outside viewport`);
    assert.equal(await page.getByText(/failed to load/i).count(), 0, `${name}: error boundary`);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    results.push({ name, passed: true });
  };
  const mount = async (component, props) => page.evaluate(({ component, props }) => {
    window.__qaContainer = document.createElement("div");
    document.body.appendChild(window.__qaContainer);
    window.__qaRoot = window.ReactDOM.createRoot(window.__qaContainer);
    window.__qaRoot.render(window.React.createElement(window[component], { ...props,
      onClose: () => window.__qaRoot.unmount(),
      onFinish: () => { window.__qaFinished = (window.__qaFinished || 0) + 1; },
    }));
  }, { component, props });
  try {
    await open();
    for (const [width, height] of [[1600, 900], [1024, 680], [900, 620]]) {
      await page.setViewportSize({ width, height });
      for (const section of ["Library", "Updates", "Settings"]) {
        await page.getByRole("button", { name: section, exact: true }).click();
        await inspect(`${section.toLowerCase()}-${width}`);
      }
    }
    for (const label of ["General", "Library & folders", "Save storage", "Notifications", "Appearance", "Emulators", "About & help"]) {
      await page.getByRole("button", { name: new RegExp(label.replace(/[&]/g, "\\&") + "$") }).click();
      await inspect(`settings-${label.replace(/[^a-z]/gi, "-")}`);
    }
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("textbox", { name: "Search library" }).fill("Harbor");
    await page.waitForFunction(() => document.querySelectorAll(".banner-root").length === 1);
    await inspect("library-search");
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await page.locator(".banner-root").first().click();
    const details = page.locator('aside[aria-label="Game details"]');
    await inspect("game-details");
    assert.equal(await details.getByText(/^\d{10,13}$/).count(), 0, "dates must not display raw timestamps");
    await details.getByRole("button", { name: "Edit title, creator and engine" }).click();
    await inspect("game-metadata-editor");
    await details.getByRole("button", { name: "Cancel", exact: true }).click();
    await details.getByRole("button", { name: "Open screenshot 1" }).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[aria-label="Screenshot viewer"]')), true);
    await inspect("screenshot-viewer");
    await page.keyboard.press("Escape");
    await details.getByRole("button", { name: "Remove game", exact: true }).click();
    const deletion = page.getByRole("alertdialog");
    await inspect("delete-game");
    const cancel = await deletion.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
    assert.ok(cancel.y >= 0 && cancel.y + cancel.height <= page.viewportSize().height, "delete actions visible");
    await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
    await details.getByRole("button", { name: "Close details" }).click();
    await page.getByRole("button", { name: /Downloads/ }).last().click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+f");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[aria-label="Downloads"]')), true);
    await inspect("downloads");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Scan Hub/ }).click();
    await inspect("scan-hub");
    await page.getByRole("button", { name: /Rebuild library from scratch/ }).click();
    const rebuild = page.getByRole("dialog", { name: "Rebuild library", exact: true });
    assert.equal(await rebuild.getByRole("button", { name: /Rebuild library/ }).isDisabled(), true);
    await inspect("rebuild-library");
    await rebuild.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.keyboard.press("Escape");

    // Confirmation closed during its delayed initial focus must stay closed.
    const focusResult = await page.evaluate(async () => {
      window.AppUI.motion.apply("full");
      const trigger = document.createElement("button");
      document.body.appendChild(trigger); trigger.focus();
      const pending = window.AppUI.confirm("Test confirmation");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = { restored: document.activeElement === trigger, inert: document.querySelector(".app-confirm-overlay")?.inert };
      trigger.remove(); window.AppUI.motion.apply("off");
      return result;
    });
    assert.equal(focusResult.restored, true); assert.equal(focusResult.inert, true);
    results.push({ name: "confirm-focus-race", passed: true });

    await open("demo=1&f95=thread");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await inspect("search-browser");
    await page.getByRole("toolbar", { name: "F95 browser" }).getByRole("button", { name: "Install", exact: true }).click();
    await page.locator('[data-notice="captcha"]').waitFor();
    await inspect("search-verification");

    // A stale catalog response must not appear during the next debounce.
    await open();
    await page.evaluate(() => {
      window.__qaSearch = {};
      window.electronAPI.searchCatalog = (query) => new Promise((resolve) => { window.__qaSearch[query] = resolve; });
    });
    await mount("CatalogLinkModal", { isOpen: true, game: { record_id: 1, title: "Alpha" } });
    await page.waitForFunction(() => !!window.__qaSearch.Alpha);
    await page.getByRole("textbox", { name: "Search the catalog" }).fill("Beta");
    await page.evaluate(() => window.__qaSearch.Alpha([{ f95Id: 1, title: "Old Alpha result" }]));
    assert.equal(await page.getByText("Old Alpha result").count(), 0);
    await page.waitForFunction(() => !!window.__qaSearch.Beta);
    await page.evaluate(() => window.__qaSearch.Beta([{ f95Id: 2, title: "New Beta result" }]));
    await page.getByText("New Beta result").waitFor();
    await inspect("catalog-search-race");

    // Pending folder discovery must retain a folder selected manually.
    await open();
    await page.evaluate(() => {
      window.electronAPI.detectGameFolders = () => new Promise((resolve) => { window.__qaFolders = resolve; });
      window.electronAPI.selectDirectory = async () => "Z:\\Manual choice";
      window.electronAPI.updateSettings = async () => ({ success: false, error: "Cannot save setup" });
    });
    await mount("OnboardingWizard", { isOpen: true, initialStep: "scan" });
    await page.waitForFunction(() => !!window.__qaFolders);
    await page.getByRole("button", { name: /Add another folder/ }).click();
    await page.evaluate(() => window.__qaFolders([{ path: "Z:\\Detected", gameCount: 1 }]));
    await page.getByText("Z:\\Manual choice", { exact: true }).waitFor();
    await page.getByText("Z:\\Detected", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Skip setup", exact: true }).click();
    await page.getByText("Cannot save setup").waitFor();
    assert.equal(await page.evaluate(() => window.__qaFinished || 0), 0);
    await inspect("onboarding-failure-and-folder-race");

    await open("demo=1&onboarding=saves");
    for (const [name, button] of [["welcome", /Get started/], ["folder", /Use this folder|Continue/], ["scan", /Not now$/], ["saves", /Continue|Keep saves on this PC/], ["accounts", /Continue$/]]) {
      await inspect(`onboarding-${name}`);
      await page.getByRole("dialog", { name: "F95Launcher setup" }).getByRole("button", { name: button }).last().click();
    }
    await inspect("onboarding-done");

    // Disconnected storage setup must not silently drop requested encryption.
    await open();
    await page.evaluate(() => {
      window.electronAPI.getSaveStorageState = async () => ({ success: true, state: { connected: false } });
      window.__qaConnectCalls = 0;
      window.electronAPI.connectSaveStorage = async () => { window.__qaConnectCalls++; return { success: true }; };
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Save storage$/ }).click();
    await page.getByRole("switch", { name: "Protect saves with a passphrase" }).click();
    await page.getByRole("button", { name: /OneDrive.*Use this cloud/ }).click();
    await page.getByText("Enter a passphrase before connecting protected storage.").waitFor();
    assert.equal(await page.evaluate(() => window.__qaConnectCalls), 0);
    await inspect("storage-empty-passphrase");
    await page.getByRole("button", { name: "WebDAV server", exact: true }).click();
    await inspect("storage-webdav-form");

    for (const [name, state] of [
      ["loading", { isLoading: true }],
      ["error", { error: "The mirror could not be reached. Try again." }],
      ["login", { needsLogin: true }],
      ["mirrors", { thread: { links: [{ url: "https://example.com/game.zip", host: "example", platform: "Windows", label: "Windows download" }] } }],
    ]) {
      await open();
      await mount("F95UpdateModal", { isOpen: true, game: { title: "Example game", versions: [] }, ...state });
      await page.getByRole("dialog", { name: "Install game" }).waitFor();
      await inspect(`install-modal-${name}`);
    }

    await open("", "/");
    await inspect("empty-library");
    await open("", "/settings.html");
    await inspect("standalone-settings");
    await open("", "/core/ui/windows/importer.html");
    await inspect("standalone-importer");
    assert.deepEqual(errors, [], "renderer exceptions");
  } finally {
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ results, errors }, null, 2));
    await browser.close();
  }
  console.log(`UI QA: ${results.length} checks passed; no renderer exceptions. Artifacts: ${out}`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
