const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createSaveStorageSync,
  isSealed,
  openBuffer,
  sealBuffer,
  deriveKey,
} = require("../src/main/saveStorage/saveStorageSync");

/** @param {unknown} error */
const codeOf = (error) => /** @type {any} */ (error)?.code;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-save-storage-sync-"));
}

function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/**
 * A minimal in-memory "database": profiles are detected from the install
 * folder's game/saves directory, sync state is kept per record.
 */
function makeFakeLibrary(root) {
  const games = new Map();
  const syncStates = new Map();
  const snapshotOf = (recordId) => {
    const game = games.get(recordId);
    if (!game) {
      return { game: null, profiles: [], syncState: null };
    }
    const savesRoot = path.join(game.installDirectory, "game", "saves");
    const profiles = fs.existsSync(savesRoot)
      ? [
          {
            provider: "local",
            rootPath: savesRoot,
            strategy: { type: "install-relative", payload: { relativePath: "game/saves" } },
            confidence: 100,
            reasons: [],
          },
        ]
      : [];
    return {
      game: {
        record_id: recordId,
        title: game.title,
        creator: "Dev",
        engine: "Ren'Py",
        siteUrl: game.siteUrl,
        versions: [{ game_path: game.installDirectory, date_added: 1 }],
      },
      profiles,
      syncState: syncStates.get(recordId) || null,
    };
  };
  return {
    games,
    syncStates,
    deps: {
      appPaths: { cache: path.join(root, "cache"), backups: path.join(root, "backups") },
      getSaveProfileSnapshot: async (recordId) => snapshotOf(recordId),
      refreshSaveProfiles: async (recordId) => snapshotOf(recordId),
      listGames: async () => [...games.keys()].map((recordId) => snapshotOf(recordId).game),
      upsertSaveSyncState: async (input) => {
        syncStates.set(input.recordId, { ...(syncStates.get(input.recordId) || {}), ...input });
        return syncStates.get(input.recordId);
      },
      appVersion: "1.6.0",
      deviceName: "PC-A",
      logger: { info() {}, warn() {}, error() {} },
    },
  };
}

test("sealBuffer/openBuffer round-trip and detect sealed payloads", () => {
  const key = deriveKey("phrase", Buffer.alloc(16, 1));
  const sealed = sealBuffer(Buffer.from("hello"), key);
  assert.equal(isSealed(sealed), true);
  assert.equal(isSealed(Buffer.from("hello")), false);
  assert.equal(openBuffer(sealed, key).toString(), "hello");
  assert.throws(() => openBuffer(sealed, deriveKey("other", Buffer.alloc(16, 1))));
});

test("upload, catalog, restore on a second PC and reconcile decisions through a folder storage", async () => {
  const root = makeTempDir();
  const storageFolder = path.join(root, "OneDrive", "F95Launcher Saves");
  const libraryA = makeFakeLibrary(path.join(root, "pc-a"));
  const installA = path.join(root, "pc-a", "Games", "Stained Blood");
  writeFiles(installA, { "game/saves/1-1-LT1.save": "slot-a", "game/saves/persistent": "p" });
  libraryA.games.set(1, { title: "Stained Blood", siteUrl: "https://f95zone.to/threads/stained-blood.284885/", installDirectory: installA });
  const connection = {
    type: "folder",
    settings: { folderPath: storageFolder, label: "OneDrive" },
    secrets: {},
    encryption: { enabled: false, passphrase: "" },
    connectedAt: "",
    deviceName: "PC-A",
  };
  const states = [];
  const syncA = createSaveStorageSync({
    ...libraryA.deps,
    getConnection: () => connection,
    onStateChanged: (state) => states.push(state),
  });
  const loaded = await syncA.load();
  assert.deepEqual(loaded, { connected: true, existing: false, encrypted: false, locked: false });
  assert.equal(fs.existsSync(path.join(storageFolder, "storage.json")), true);

  const first = await syncA.reconcileGame(1);
  assert.equal(first.action, "upload");
  assert.equal(fs.existsSync(path.join(storageFolder, "games", "f95-284885", "latest.zip")), true);
  const catalog = await syncA.readCatalog();
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0].title, "Stained Blood");
  assert.equal(catalog.entries[0].fileCount, 2);
  assert.equal(libraryA.syncStates.get(1).syncStatus, "uploaded");

  const again = await syncA.reconcileGame(1);
  assert.equal(again.action, "noop");
  assert.equal(again.reason, "already-synced");

  // Second PC, same storage, fresh install without saves.
  const libraryB = makeFakeLibrary(path.join(root, "pc-b"));
  const installB = path.join(root, "pc-b", "Games", "Stained Blood");
  fs.mkdirSync(installB, { recursive: true });
  libraryB.games.set(7, { title: "Stained Blood", siteUrl: "https://f95zone.to/threads/stained-blood.284885/", installDirectory: installB });
  const syncB = createSaveStorageSync({ ...libraryB.deps, deviceName: "PC-B", getConnection: () => connection });
  const loadedB = await syncB.load();
  assert.equal(loadedB.existing, true);
  const restore = await syncB.reconcileGame(7);
  assert.equal(restore.action, "restore");
  assert.equal(fs.readFileSync(path.join(installB, "game", "saves", "1-1-LT1.save"), "utf8"), "slot-a");
  assert.equal(libraryB.syncStates.get(7).syncStatus, "restored");

  // PC-B plays and saves; the next reconcile uploads and keeps history.
  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(path.join(installB, "game", "saves", "1-1-LT1.save"), "slot-b");
  const uploadB = await syncB.reconcileGame(7);
  assert.equal(uploadB.action, "upload");
  const history = fs.readdirSync(path.join(storageFolder, "games", "f95-284885", "history"));
  assert.equal(history.length, 1);

  // PC-A now restores the newer copy.
  const backA = await syncA.reconcileGame(1);
  assert.equal(backA.action, "restore");
  assert.equal(fs.readFileSync(path.join(installA, "game", "saves", "1-1-LT1.save"), "utf8"), "slot-b");

  const summary = await syncA.syncAll({ emitProgress: false });
  assert.equal(summary.total, 1);
  assert.equal(summary.synced, 1);
  assert.ok(states.length > 0);
  assert.equal(syncA.getStatus().connected, true);

  await syncA.clearRemoteGame(1);
  assert.equal((await syncA.readCatalog()).entries.length, 0);
  assert.equal(fs.existsSync(path.join(storageFolder, "games", "f95-284885", "latest.zip")), false);
});

test("an encrypted storage seals every object, needs the passphrase on reconnect and rejects a wrong one", async () => {
  const root = makeTempDir();
  const storageFolder = path.join(root, "Dropbox", "F95Launcher Saves");
  const library = makeFakeLibrary(path.join(root, "pc"));
  const install = path.join(root, "pc", "Game");
  writeFiles(install, { "game/saves/slot.save": "secret-save" });
  library.games.set(1, { title: "Game", siteUrl: "https://f95zone.to/threads/game.1/", installDirectory: install });
  const connection = {
    type: "folder",
    settings: { folderPath: storageFolder },
    secrets: {},
    encryption: { enabled: true, passphrase: "my phrase" },
    connectedAt: "",
    deviceName: "",
  };
  const sync = createSaveStorageSync({ ...library.deps, getConnection: () => connection });
  const loaded = await sync.load();
  assert.equal(loaded.encrypted, true);
  await sync.uploadGame(1);
  const archive = fs.readFileSync(path.join(storageFolder, "games", "f95-1", "latest.zip"));
  assert.equal(isSealed(archive), true);
  assert.equal(archive.includes("secret-save"), false);
  assert.equal(isSealed(fs.readFileSync(path.join(storageFolder, "catalog.json"))), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(storageFolder, "storage.json"), "utf8")).encrypted, true);

  const noPhrase = createSaveStorageSync({
    ...library.deps,
    getConnection: () => ({ ...connection, encryption: { enabled: true, passphrase: "" } }),
  });
  const lockedLoad = await noPhrase.load();
  assert.equal(lockedLoad.locked, true);
  assert.equal(noPhrase.getStatus().locked, true);
  await assert.rejects(() => noPhrase.readCatalog(), (error) => codeOf(error) === "locked");

  const wrong = createSaveStorageSync({
    ...library.deps,
    getConnection: () => ({ ...connection, encryption: { enabled: true, passphrase: "wrong" } }),
  });
  const wrongLoad = await wrong.load();
  assert.equal(wrongLoad.locked, true);
  assert.match(String(wrongLoad.error), /passphrase/i);

  const unlocked = await noPhrase.load({ passphrase: "my phrase" });
  assert.equal(unlocked.locked, false);
  assert.equal((await noPhrase.readCatalog()).entries[0].title, "Game");
});

test("restore reports a missing backup and upload reports missing saves", async () => {
  const root = makeTempDir();
  const library = makeFakeLibrary(path.join(root, "pc"));
  const install = path.join(root, "pc", "Game");
  fs.mkdirSync(install, { recursive: true });
  library.games.set(1, { title: "Game", siteUrl: "https://f95zone.to/threads/game.5/", installDirectory: install });
  const sync = createSaveStorageSync({
    ...library.deps,
    getConnection: () => ({ type: "folder", settings: { folderPath: path.join(root, "store") }, secrets: {}, encryption: { enabled: false, passphrase: "" }, connectedAt: "", deviceName: "" }),
  });
  await sync.load();
  await assert.rejects(() => sync.restoreGame(1), (error) => codeOf(error) === "no_backup");
  await assert.rejects(() => sync.uploadGame(1), (error) => codeOf(error) === "no_saves");
  assert.equal((await sync.reconcileGame(1)).action, "noop");
});
