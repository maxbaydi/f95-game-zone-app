const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildAppPaths,
  ensureAppDirs,
  resolveLegacyPaths,
  migrateLegacyData,
  initializeAppPaths,
} = require("../src/main/appPaths");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-stage0-"));
}

test("buildAppPaths computes the expected writable layout", () => {
  const root = path.join("C:\\", "Users", "tester", "AppData", "Roaming", "Atlas");
  const appPaths = buildAppPaths(root);

  assert.equal(appPaths.root, path.resolve(root));
  assert.equal(appPaths.data, path.join(appPaths.root, "data"));
  assert.equal(appPaths.cache, path.join(appPaths.root, "cache"));
  assert.equal(appPaths.logs, path.join(appPaths.root, "logs"));
  assert.equal(appPaths.backups, path.join(appPaths.root, "backups"));
  assert.equal(appPaths.db, path.join(appPaths.data, "data.db"));
  assert.equal(appPaths.config, path.join(appPaths.data, "config.ini"));
  assert.equal(appPaths.images, path.join(appPaths.cache, "images"));
  assert.equal(appPaths.launchers, path.join(appPaths.data, "launchers"));
  assert.equal(appPaths.updates, path.join(appPaths.cache, "updates"));
});

test("ensureAppDirs creates all required writable directories", () => {
  const root = makeTempDir();
  const appPaths = buildAppPaths(path.join(root, "userData"));

  ensureAppDirs(appPaths);

  for (const directoryPath of [
    appPaths.root,
    appPaths.data,
    appPaths.cache,
    appPaths.logs,
    appPaths.backups,
    appPaths.launchers,
    appPaths.games,
    appPaths.images,
    appPaths.updates,
    appPaths.bannerTemplates,
  ]) {
    assert.equal(fs.existsSync(directoryPath), true, `${directoryPath} should exist`);
  }
});

test("resolveLegacyPaths uses src-root in development and resources root when packaged", () => {
  const development = resolveLegacyPaths({
    appPath: "C:\\projects\\atlas",
    isPackaged: false,
    mainDir: "C:\\projects\\atlas\\src",
  });
  const packaged = resolveLegacyPaths({
    appPath: "C:\\Program Files\\Atlas\\resources\\app.asar",
    isPackaged: true,
    mainDir: "C:\\ignored",
  });

  assert.equal(development.data, path.join("C:\\projects\\atlas\\src", "data"));
  assert.equal(development.launchers, path.join("C:\\projects\\atlas\\src", "launchers"));
  assert.equal(packaged.data, path.join("C:\\Program Files\\Atlas", "data"));
  assert.equal(packaged.launchers, path.join("C:\\Program Files\\Atlas", "launchers"));
});

test("migrateLegacyData copies legacy data into the new layout once without overwriting user data", () => {
  const root = makeTempDir();
  const legacyRoot = path.join(root, "legacy-src");
  const userDataRoot = path.join(root, "userData");
  const appPaths = buildAppPaths(userDataRoot);

  fs.mkdirSync(path.join(legacyRoot, "data", "images", "42"), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, "data", "updates"), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, "data", "templates", "banner"), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, "launchers"), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "data", "data.db"), "legacy-db");
  fs.writeFileSync(path.join(legacyRoot, "data", "config.ini"), "legacy-config");
  fs.writeFileSync(path.join(legacyRoot, "data", "images", "42", "banner.webp"), "legacy-image");
  fs.writeFileSync(path.join(legacyRoot, "launchers", "emu.exe"), "legacy-launcher");

  ensureAppDirs(appPaths);
  fs.writeFileSync(appPaths.config, "user-config");

  migrateLegacyData(
    appPaths,
    {
      root: legacyRoot,
      data: path.join(legacyRoot, "data"),
      launchers: path.join(legacyRoot, "launchers"),
    },
    {
      info() {},
      warn() {},
      error() {},
    },
  );

  assert.equal(fs.readFileSync(appPaths.db, "utf8"), "legacy-db");
  assert.equal(fs.readFileSync(appPaths.config, "utf8"), "user-config");
  assert.equal(fs.readFileSync(path.join(appPaths.images, "42", "banner.webp"), "utf8"), "legacy-image");
  assert.equal(fs.readFileSync(path.join(appPaths.launchers, "emu.exe"), "utf8"), "legacy-launcher");
});

test("initializeAppPaths never resolves writable storage inside the install tree", () => {
  const installRoot = makeTempDir();
  const userDataRoot = path.join(makeTempDir(), "profile");
  const appPaths = initializeAppPaths(
    {
      getPath(name) {
        assert.equal(name, "userData");
        return userDataRoot;
      },
      getAppPath() {
        return path.join(installRoot, "resources", "app.asar");
      },
      isPackaged: true,
    },
    {
      mainDir: path.join(installRoot, "src"),
    },
  );

  for (const writablePath of [
    appPaths.root,
    appPaths.data,
    appPaths.cache,
    appPaths.logs,
    appPaths.backups,
    appPaths.launchers,
    appPaths.images,
    appPaths.updates,
    appPaths.db,
    appPaths.config,
  ]) {
    assert.equal(path.relative(installRoot, writablePath).startsWith(".."), true, `${writablePath} must stay outside install root`);
  }
});
