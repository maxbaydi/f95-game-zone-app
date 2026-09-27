const test = require("node:test");
const assert = require("node:assert/strict");

const {
  annotateLibraryPresence,
  createPathPresenceProbe,
  resolveGameInstallState,
} = require("../src/main/libraryPresence");

/**
 * @param {string[]} existingPaths
 */
function makeProbe(existingPaths) {
  const known = new Set(existingPaths.map((entry) => entry.toLowerCase()));
  return async (targetPath) => ({
    exists: known.has(String(targetPath).toLowerCase()),
    known: true,
  });
}

test("annotateLibraryPresence marks each version and derives the install state", async () => {
  const games = [
    {
      record_id: 1,
      title: "Present",
      latestVersion: "0.5",
      versions: [
        {
          version: "0.5",
          game_path: "C:\\Games\\Present",
          exec_path: "C:\\Games\\Present\\game.exe",
          date_added: 10,
        },
      ],
    },
    {
      record_id: 2,
      title: "Missing",
      latestVersion: "0.9",
      versions: [
        {
          version: "0.4",
          game_path: "D:\\Gone\\Missing",
          exec_path: "D:\\Gone\\Missing\\game.exe",
          date_added: 5,
        },
      ],
    },
    { record_id: 3, title: "Stub", latestVersion: "1.0", versions: [] },
  ];

  const annotated = await annotateLibraryPresence(games, {
    probe: makeProbe(["C:\\Games\\Present"]),
  });

  assert.equal(annotated[0].installState, "installed");
  assert.equal(annotated[0].versions[0].isPresent, true);
  assert.equal(annotated[0].versions[0].presenceKnown, true);
  assert.equal(annotated[0].presentVersionCount, 1);
  assert.equal(annotated[0].missingVersionCount, 0);

  assert.equal(annotated[1].installState, "missing");
  assert.equal(annotated[1].versions[0].isPresent, false);
  assert.equal(annotated[1].presentVersionCount, 0);
  assert.equal(annotated[1].missingVersionCount, 1);

  assert.equal(annotated[2].installState, "not_installed");
  assert.equal(annotated[2].presentVersionCount, 0);
  assert.equal(annotated[2].missingVersionCount, 0);
});

test("update availability only counts versions that exist on disk", async () => {
  const games = [
    {
      record_id: 1,
      latestVersion: "0.9",
      versions: [
        { version: "0.9", game_path: "D:\\Gone\\Game", date_added: 20 },
        { version: "0.5", game_path: "C:\\Games\\Game", date_added: 10 },
      ],
    },
  ];

  const [game] = await annotateLibraryPresence(games, {
    probe: makeProbe(["C:\\Games\\Game"]),
  });

  assert.equal(game.installState, "installed");
  assert.equal(game.newestInstalledVersion, "0.5");
  assert.equal(game.lastKnownVersion, "0.9");
  assert.equal(game.isUpdateAvailable, true);
});

test("a game whose files are all missing never reports an update", async () => {
  const games = [
    {
      record_id: 1,
      latestVersion: "2.0",
      isUpdateAvailable: true,
      newestInstalledVersion: "1.0",
      versions: [{ version: "1.0", game_path: "D:\\Gone\\Game", date_added: 1 }],
    },
  ];

  const [game] = await annotateLibraryPresence(games, { probe: makeProbe([]) });

  assert.equal(game.installState, "missing");
  assert.equal(game.isUpdateAvailable, false);
  assert.equal(game.newestInstalledVersion, "");
  assert.equal(game.lastKnownVersion, "1.0");
});

test("a library stub without versions never reports an update", async () => {
  const [game] = await annotateLibraryPresence(
    [{ record_id: 4, latestVersion: "3.0", isUpdateAvailable: true, versions: [] }],
    { probe: makeProbe([]) },
  );

  assert.equal(game.installState, "not_installed");
  assert.equal(game.isUpdateAvailable, false);
  assert.equal(game.lastKnownVersion, "");
});

test("unknown presence (probe timeout) is treated as present and flagged", async () => {
  const probe = async () => ({ exists: false, known: false });
  const [game] = await annotateLibraryPresence(
    [
      {
        record_id: 1,
        latestVersion: "",
        versions: [{ version: "1.0", game_path: "\\\\nas\\games\\x", date_added: 1 }],
      },
    ],
    { probe },
  );

  assert.equal(game.installState, "installed");
  assert.equal(game.versions[0].isPresent, true);
  assert.equal(game.versions[0].presenceKnown, false);
  assert.equal(game.presenceUnknownCount, 1);
});

test("versions without a folder path count as missing", async () => {
  const [game] = await annotateLibraryPresence(
    [{ record_id: 1, latestVersion: "", versions: [{ version: "1.0", game_path: "", date_added: 1 }] }],
    { probe: makeProbe([]) },
  );

  assert.equal(game.installState, "missing");
  assert.equal(game.versions[0].isPresent, false);
});

test("annotateLibraryPresence does not mutate the input and tolerates bad input", async () => {
  const version = { version: "1.0", game_path: "C:\\Games\\A", date_added: 1 };
  const game = { record_id: 1, latestVersion: "", versions: [version] };

  const [annotated] = await annotateLibraryPresence([game], {
    probe: makeProbe(["C:\\Games\\A"]),
  });

  assert.equal("isPresent" in version, false);
  assert.equal("installState" in game, false);
  assert.equal(annotated.versions[0].isPresent, true);
  assert.deepEqual(await annotateLibraryPresence(null, { probe: makeProbe([]) }), []);
});

test("resolveGameInstallState derives the state from annotated versions", () => {
  assert.equal(resolveGameInstallState([]), "not_installed");
  assert.equal(resolveGameInstallState([{ isPresent: false }]), "missing");
  assert.equal(
    resolveGameInstallState([{ isPresent: false }, { isPresent: true }]),
    "installed",
  );
});

test("createPathPresenceProbe caches results and short-circuits missing drive roots", async () => {
  const calls = [];
  const stat = async (targetPath) => {
    calls.push(String(targetPath).toLowerCase());
    if (String(targetPath).toLowerCase().startsWith("d:")) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return { isDirectory: () => true };
  };
  const probe = createPathPresenceProbe({ stat, platform: "win32", timeoutMs: 50 });

  assert.deepEqual(await probe("D:\\Games\\A"), { exists: false, known: true });
  assert.deepEqual(await probe("D:\\Games\\B"), { exists: false, known: true });
  assert.deepEqual(calls, ["d:\\"]);

  assert.deepEqual(await probe("C:\\Games\\A"), { exists: true, known: true });
  assert.deepEqual(await probe("C:\\Games\\A"), { exists: true, known: true });
  assert.deepEqual(await probe("c:\\games\\a"), { exists: true, known: true });
  assert.equal(calls.filter((entry) => entry === "c:\\games\\a").length, 1);
  assert.equal(calls.filter((entry) => entry === "c:\\").length, 1);
});

test("createPathPresenceProbe reports a file where a folder is expected as missing", async () => {
  const stat = async () => ({ isDirectory: () => false });
  const probe = createPathPresenceProbe({ stat, platform: "linux", timeoutMs: 50 });

  assert.deepEqual(await probe("/games/archive.zip"), { exists: false, known: true });
});

test("createPathPresenceProbe reports unknown when stat does not answer in time", async () => {
  const stat = () => new Promise(() => {});
  const probe = createPathPresenceProbe({ stat, platform: "linux", timeoutMs: 20 });

  assert.deepEqual(await probe("/mnt/nas/game"), { exists: false, known: false });
});

test("createPathPresenceProbe treats other stat errors as unknown, not missing", async () => {
  const stat = async () => {
    throw Object.assign(new Error("EPERM"), { code: "EPERM" });
  };
  const probe = createPathPresenceProbe({ stat, platform: "linux", timeoutMs: 50 });

  assert.deepEqual(await probe("/locked/game"), { exists: false, known: false });
});

test("createPathPresenceProbe rejects empty paths without touching the disk", async () => {
  let called = false;
  const stat = async () => {
    called = true;
    return { isDirectory: () => true };
  };
  const probe = createPathPresenceProbe({ stat, platform: "linux", timeoutMs: 50 });

  assert.deepEqual(await probe(""), { exists: false, known: true });
  assert.deepEqual(await probe(null), { exists: false, known: true });
  assert.equal(called, false);
});

test("createPathPresenceProbe marks every path on an unreachable drive as unknown after one timeout", async () => {
  const calls = [];
  const stat = (targetPath) => {
    calls.push(String(targetPath).toLowerCase());
    return new Promise(() => {});
  };
  const probe = createPathPresenceProbe({ stat, platform: "win32", timeoutMs: 20 });

  assert.deepEqual(await probe("\\\\nas\\games\\A"), { exists: false, known: false });
  assert.deepEqual(await probe("\\\\nas\\games\\B"), { exists: false, known: false });
  assert.deepEqual(calls, ["\\\\nas\\games\\"]);
});
