const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createFolderProvider,
  createS3Provider,
  createWebDavProvider,
  normalizeStoragePath,
  parseWebDavMultistatus,
} = require("../src/main/saveStorage/providers");
const { detectCloudSyncFolders } = require("../src/main/saveStorage/cloudFolderDetector");
const {
  buildConnectionCard,
  buildStorageSection,
  createSecretsStore,
  describeConnection,
  readConnectionCard,
  readStorageSettings,
  splitConnectionInput,
} = require("../src/main/saveStorage/storageConfig");

/** @param {unknown} error */
const codeOf = (error) => /** @type {any} */ (error)?.code;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-save-storage-"));
}

test("storage paths are normalised and traversal is refused", () => {
  assert.equal(normalizeStoragePath("games\\f95-1\\latest.zip"), "games/f95-1/latest.zip");
  assert.equal(normalizeStoragePath("/games//x/"), "games/x");
  assert.throws(() => normalizeStoragePath("../evil"), (error) => codeOf(error) === "invalid_path");
});

test("folder provider writes atomically, lists recursively and reports missing objects as null", async () => {
  const root = path.join(makeTempDir(), "F95Launcher Saves");
  const provider = createFolderProvider({ folderPath: root });
  assert.equal((await provider.test()).ok, true);
  await provider.write("games/f95-1/latest.zip", Buffer.from("zip"));
  await provider.write("catalog.json", Buffer.from("{}"));
  assert.equal((await provider.read("games/f95-1/latest.zip")).toString(), "zip");
  assert.equal(await provider.read("games/nope.zip"), null);
  const listed = (await provider.list("games")).map((entry) => entry.path).sort();
  assert.deepEqual(listed, ["games/f95-1/latest.zip"]);
  assert.equal(fs.readdirSync(path.join(root, "games", "f95-1")).some((name) => name.includes(".~")), false, "no temp files left");
  await provider.remove("games/f95-1/latest.zip");
  assert.equal(await provider.read("games/f95-1/latest.zip"), null);
  await provider.remove("games/f95-1/latest.zip");
});

test("WebDAV multistatus parsing survives namespace prefixes", () => {
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/me/F95Launcher%20Saves/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/me/F95Launcher%20Saves/catalog.json</d:href><d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:getlastmodified>Mon, 29 Sep 2026 10:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>`;
  const entries = parseWebDavMultistatus(xml);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].isCollection, true);
  assert.equal(entries[1].size, 12);
  assert.ok(entries[1].mtimeMs > 0);
});

test("WebDAV provider issues PUT/GET/DELETE/PROPFIND with basic auth and creates parents on 409", async () => {
  const calls = [];
  const store = new Map();
  const fetchImpl = async (url, init) => {
    const method = init.method;
    const pathname = decodeURIComponent(new URL(url).pathname);
    calls.push(`${method} ${pathname}`);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from("me:app-pass").toString("base64")}`);
    const relative = pathname.replace(/^\/dav\/root\//, "");
    if (method === "PUT") {
      if (relative.includes("/") && !store.has(`dir:${relative.split("/").slice(0, -1).join("/")}`)) {
        return new Response("", { status: 409 });
      }
      store.set(relative, Buffer.from(await new Response(init.body).arrayBuffer()));
      return new Response("", { status: 201 });
    }
    if (method === "MKCOL") {
      store.set(`dir:${relative.replace(/\/$/, "")}`, true);
      return new Response("", { status: 201 });
    }
    if (method === "GET") {
      return store.has(relative) ? new Response(store.get(relative), { status: 200 }) : new Response("", { status: 404 });
    }
    if (method === "DELETE") {
      store.delete(relative);
      return new Response(null, { status: 204 });
    }
    if (method === "PROPFIND") {
      const dir = relative.replace(/\/$/, "");
      const files = [...store.keys()].filter((key) => !key.startsWith("dir:") && key.startsWith(`${dir}/`) && !key.slice(dir.length + 1).includes("/"));
      const body = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/root/${dir}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>${files
        .map((file) => `<d:response><d:href>/dav/root/${encodeURI(file)}</d:href><d:propstat><d:prop><d:getcontentlength>${store.get(file).length}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>`)
        .join("")}</d:multistatus>`;
      return new Response(body, { status: 207 });
    }
    return new Response("", { status: 500 });
  };
  const provider = createWebDavProvider({ url: "https://cloud.example.org/dav/root", username: "me", password: "app-pass", fetchImpl });
  await provider.write("F95Launcher Saves/games/f95-9/latest.zip", Buffer.from("zip"));
  assert.ok(calls.includes("MKCOL /dav/root/F95Launcher Saves/games/f95-9/"), calls.join("\n"));
  assert.equal((await provider.read("F95Launcher Saves/games/f95-9/latest.zip")).toString(), "zip");
  assert.equal(await provider.read("F95Launcher Saves/missing.zip"), null);
  const listed = await provider.list("F95Launcher Saves/games/f95-9");
  assert.deepEqual(listed.map((entry) => entry.path), ["F95Launcher Saves/games/f95-9/latest.zip"]);
  await provider.remove("F95Launcher Saves/games/f95-9/latest.zip");
  assert.equal(await provider.read("F95Launcher Saves/games/f95-9/latest.zip"), null);
});

test("WebDAV provider maps 401 to a login error", async () => {
  const provider = createWebDavProvider({
    url: "https://cloud.example.org/dav/",
    username: "me",
    password: "wrong",
    fetchImpl: async () => new Response("", { status: 401 }),
  });
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.equal(result.details.code, "auth_failed");
});

test("S3 provider signs requests with SigV4 and parses listings", async () => {
  const calls = [];
  const store = new Map();
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ method: init.method, url: parsed.toString(), headers: init.headers });
    assert.match(init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIA\/20260929\/auto\/s3\/aws4_request, SignedHeaders=/);
    assert.equal(init.headers["x-amz-date"], "20260929T100000Z");
    const key = decodeURIComponent(parsed.pathname.replace(/^\/bucket\/?/, ""));
    if (init.method === "PUT") {
      store.set(key, Buffer.from(await new Response(init.body).arrayBuffer()));
      return new Response("", { status: 200 });
    }
    if (init.method === "GET" && parsed.searchParams.get("list-type") === "2") {
      const prefix = parsed.searchParams.get("prefix") || "";
      const keys = [...store.keys()].filter((entry) => entry.startsWith(prefix));
      return new Response(
        `<ListBucketResult>${keys.map((entry) => `<Contents><Key>${entry}</Key><Size>${store.get(entry).length}</Size><LastModified>2026-09-29T10:00:00.000Z</LastModified></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`,
        { status: 200 },
      );
    }
    if (init.method === "GET") {
      return store.has(key) ? new Response(store.get(key), { status: 200 }) : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    }
    if (init.method === "DELETE") {
      store.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 500 });
  };
  const provider = createS3Provider({
    endpoint: "https://account.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "bucket",
    prefix: "f95launcher-saves",
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
    fetchImpl,
    now: () => new Date("2026-09-29T10:00:00Z"),
  });
  await provider.write("games/f95-1/latest.zip", Buffer.from("zip"));
  assert.equal(calls[0].url, "https://account.r2.cloudflarestorage.com/bucket/f95launcher-saves/games/f95-1/latest.zip");
  assert.equal((await provider.read("games/f95-1/latest.zip")).toString(), "zip");
  assert.equal(await provider.read("games/f95-1/none.zip"), null);
  const listed = await provider.list("games");
  assert.deepEqual(listed.map((entry) => entry.path), ["games/f95-1/latest.zip"]);
  await provider.remove("games/f95-1/latest.zip");
  assert.deepEqual(await provider.list("games"), []);
});

test("cloud sync folders are detected from env, Dropbox info.json and well-known folders", () => {
  const home = makeTempDir();
  const oneDrive = path.join(home, "OneDrive");
  const dropbox = path.join(home, "Dropbox Personal");
  const yandex = path.join(home, "YandexDisk");
  fs.mkdirSync(oneDrive, { recursive: true });
  fs.mkdirSync(dropbox, { recursive: true });
  fs.mkdirSync(yandex, { recursive: true });
  const localAppData = path.join(home, "AppData", "Local");
  fs.mkdirSync(path.join(localAppData, "Dropbox"), { recursive: true });
  fs.writeFileSync(path.join(localAppData, "Dropbox", "info.json"), JSON.stringify({ personal: { path: dropbox } }));

  const detected = detectCloudSyncFolders({
    env: { OneDriveConsumer: oneDrive, LOCALAPPDATA: localAppData, USERPROFILE: home },
    homeDir: home,
    platform: "win32",
    driveLetters: [],
  });
  const ids = detected.map((entry) => entry.id);
  assert.deepEqual(ids, ["onedrive", "dropbox", "yandexdisk"]);
  assert.equal(detected[0].suggestedPath, path.join(oneDrive, "F95Launcher Saves"));
  assert.equal(detected[1].path, dropbox);
  assert.equal(detected.every((entry) => entry.recommended), true);
});

test("connection settings split into config and secrets, and the config section never keeps stale keys", () => {
  const split = splitConnectionInput("webdav", { url: " https://x.example/dav ", username: "me", password: "pw", junk: "no" });
  assert.deepEqual(split, { settings: { url: "https://x.example/dav", username: "me" }, secrets: { password: "pw" } });

  const section = buildStorageSection({
    type: "webdav",
    settings: split.settings,
    secrets: split.secrets,
    encryption: { enabled: true, passphrase: "x" },
    connectedAt: "2026-09-29T10:00:00.000Z",
    deviceName: "PC",
  });
  assert.equal(section.type, "webdav");
  assert.equal(section.url, "https://x.example/dav");
  assert.equal(section.folderPath, "", "keys of other types are blanked");
  assert.equal(section.encryption, "true");
  assert.equal("password" in section, false, "secrets never reach config.ini");

  const read = readStorageSettings({ SaveStorage: section });
  assert.equal(read.type, "webdav");
  assert.equal(read.encryptionEnabled, true);
  assert.deepEqual(read.settings, { url: "https://x.example/dav", username: "me" });
  assert.equal(readStorageSettings({ SaveStorage: buildStorageSection(null) }), null);
  assert.equal(describeConnection({ type: "folder", settings: { label: "OneDrive", folderPath: "C:/x" } }), "OneDrive · C:/x");
});

test("secrets store falls back to plain JSON without safeStorage and encrypts with it", () => {
  const dataDir = makeTempDir();
  const plain = createSecretsStore({ dataDir, safeStorage: null });
  assert.equal(plain.isEncrypted, false);
  plain.write({ secrets: { password: "pw" }, passphrase: "phrase" });
  assert.deepEqual(plain.read(), { secrets: { password: "pw" }, passphrase: "phrase" });

  const fakeSafe = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").toString("base64")),
    decryptString: (buffer) => Buffer.from(buffer.toString(), "base64").toString("utf8"),
  };
  const secure = createSecretsStore({ dataDir, safeStorage: fakeSafe });
  secure.write({ secrets: { secretAccessKey: "s3" }, passphrase: "" });
  const raw = JSON.parse(fs.readFileSync(secure.filePath, "utf8"));
  assert.equal(raw.encrypted, true);
  assert.equal(JSON.stringify(raw).includes("s3"), false, "secret is not in clear text");
  assert.deepEqual(secure.read(), { secrets: { secretAccessKey: "s3" }, passphrase: "" });
  secure.clear();
  assert.equal(secure.read(), null);
});

test("connection cards round-trip, sealed cards need the passphrase", () => {
  const connection = {
    type: "s3",
    settings: { endpoint: "https://s3.example", bucket: "b", accessKeyId: "AK", region: "auto", prefix: "p" },
    secrets: { secretAccessKey: "SK" },
    encryption: { enabled: true, passphrase: "saves-phrase" },
    connectedAt: "",
    deviceName: "",
  };
  const plainCard = buildConnectionCard(connection, { appVersion: "1.6.0", now: () => new Date("2026-09-29T10:00:00Z") });
  assert.equal(plainCard.sealed, false);
  const restored = readConnectionCard(plainCard);
  assert.equal(restored.type, "s3");
  assert.equal(restored.secrets.secretAccessKey, "SK");
  assert.equal(restored.encryption.passphrase, "saves-phrase");

  const sealed = buildConnectionCard(connection, { passphrase: "card-pass" });
  assert.equal(sealed.sealed, true);
  assert.equal(JSON.stringify(sealed).includes("SK"), false);
  assert.throws(() => readConnectionCard(sealed), (error) => codeOf(error) === "card_passphrase_required");
  assert.throws(() => readConnectionCard(sealed, { passphrase: "nope" }), (error) => codeOf(error) === "card_wrong_passphrase");
  assert.equal(readConnectionCard(sealed, { passphrase: "card-pass" }).settings.bucket, "b");
  assert.throws(() => readConnectionCard({ format: "other" }), (error) => codeOf(error) === "invalid_card");
});
