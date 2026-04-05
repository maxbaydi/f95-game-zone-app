const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideSaveSyncPlan,
  getManifestLatestMtimeMs,
} = require("../src/shared/saveSyncPlan");

function createManifest(hash, mtimeMsValues) {
  return {
    manifestHash: hash,
    entries: (mtimeMsValues || []).map((mtimeMs, index) => ({
      path: `profiles/local/file-${index}.save`,
      mtimeMs,
    })),
  };
}

test("save sync plan uploads when only local saves exist", () => {
  const plan = decideSaveSyncPlan({
    localManifest: createManifest("local-hash", [10]),
    remoteManifest: null,
    syncState: null,
  });

  assert.deepEqual(plan, {
    action: "upload",
    reason: "remote-missing",
  });
});

test("save sync plan restores when only cloud saves exist", () => {
  const plan = decideSaveSyncPlan({
    localManifest: null,
    remoteManifest: createManifest("remote-hash", [10]),
    syncState: null,
  });

  assert.deepEqual(plan, {
    action: "restore",
    reason: "local-missing",
  });
});

test("save sync plan noops when hashes already match", () => {
  const plan = decideSaveSyncPlan({
    localManifest: createManifest("same-hash", [10]),
    remoteManifest: createManifest("same-hash", [20]),
    syncState: {
      lastLocalManifestHash: "same-hash",
      lastRemoteManifestHash: "same-hash",
    },
  });

  assert.deepEqual(plan, {
    action: "noop",
    reason: "already-synced",
  });
});

test("save sync plan prefers upload when only local hash changed since last sync", () => {
  const plan = decideSaveSyncPlan({
    localManifest: createManifest("local-new", [40]),
    remoteManifest: createManifest("remote-old", [25]),
    syncState: {
      lastLocalManifestHash: "local-old",
      lastRemoteManifestHash: "remote-old",
    },
  });

  assert.deepEqual(plan, {
    action: "upload",
    reason: "local-changed",
  });
});

test("save sync plan prefers restore when both sides changed but cloud files are newer", () => {
  const plan = decideSaveSyncPlan({
    localManifest: createManifest("local-new", [40]),
    remoteManifest: createManifest("remote-new", [80]),
    syncState: {
      lastLocalManifestHash: "local-old",
      lastRemoteManifestHash: "remote-old",
    },
  });

  assert.deepEqual(plan, {
    action: "restore",
    reason: "remote-newer",
  });
});

test("save sync plan marks equal-time divergence as conflict", () => {
  const plan = decideSaveSyncPlan({
    localManifest: createManifest("local-new", [80]),
    remoteManifest: createManifest("remote-new", [80]),
    syncState: {
      lastLocalManifestHash: "local-old",
      lastRemoteManifestHash: "remote-old",
    },
  });

  assert.deepEqual(plan, {
    action: "conflict",
    reason: "ambiguous-divergence",
  });
});

test("save sync plan reports latest entry mtime", () => {
  assert.equal(
    getManifestLatestMtimeMs(createManifest("hash", [5, 120, 33])),
    120,
  );
});
