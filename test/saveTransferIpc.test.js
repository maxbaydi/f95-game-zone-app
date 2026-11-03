const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { registerSaveTransferIpc } = require("../src/main/saveTransferIpc");

test("import IPC returns failure and preserves local saves if backup fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "save-import-ipc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, "game", "saves");
  fs.mkdirSync(saves, { recursive: true });
  fs.writeFileSync(path.join(saves, "slot.save"), "local progress");
  const backups = path.join(root, "blocked-backups");
  fs.writeFileSync(backups, "not a directory");
  const archivePath = path.join(root, "import.zip");
  const zip = new AdmZip();
  zip.addFile("slot.save", Buffer.from("older progress"));
  zip.writeZip(archivePath);
  const snapshot = {
    game: { title: "Game", versions: [{ game_path: path.join(root, "game") }] },
    profiles: [{ provider: "local", rootPath: saves, strategy: { type: "install-relative", payload: { relativePath: "saves" } } }],
  };
  const handlers = new Map();
  const errors = [];
  registerSaveTransferIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    appPaths: { backups, cache: root },
    dialog: { showOpenDialog: async () => ({}), showSaveDialog: async () => ({}) },
    shell: { openPath: async () => "", showItemInFolder() {} },
    app: { getPath: () => root, getVersion: () => "test" },
    getParentWindow: () => null,
    getDatabaseConnection: () => ({}),
    getSaveProfileSnapshot: async () => snapshot,
    refreshSaveProfiles: async () => snapshot,
    listGames: async () => [],
    logger: { info() {}, warn() {}, error: (...args) => errors.push(args) },
  });
  const result = await handlers.get("import-game-saves")({}, { recordId: 1, archivePath });
  assert.equal(result.success, false);
  assert.equal(fs.readFileSync(path.join(saves, "slot.save"), "utf8"), "local progress");
  assert.equal(errors.length, 1);
});
