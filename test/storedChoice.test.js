const test = require("node:test");
const assert = require("node:assert/strict");

const { readStoredChoice, writeStoredChoice } = require("../src/shared/storedChoice");

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

test("readStoredChoice returns the stored value only when it is allowed", () => {
  const storage = makeStorage({ "f95.sort": "titleAsc", "f95.filter": "bogus" });

  assert.equal(readStoredChoice(storage, "f95.sort", ["titleAsc", "titleDesc"], "titleDesc"), "titleAsc");
  assert.equal(readStoredChoice(storage, "f95.filter", ["all", "missing"], "all"), "all");
  assert.equal(readStoredChoice(storage, "f95.unknown", ["a"], "a"), "a");
});

test("readStoredChoice survives a missing or throwing storage", () => {
  assert.equal(readStoredChoice(null, "k", ["a"], "a"), "a");
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readStoredChoice(throwing, "k", ["a", "b"], "b"), "b");
});

test("writeStoredChoice persists allowed values and removes disallowed ones", () => {
  const storage = makeStorage();

  assert.equal(writeStoredChoice(storage, "f95.sort", "titleAsc", ["titleAsc"]), true);
  assert.equal(storage.getItem("f95.sort"), "titleAsc");

  assert.equal(writeStoredChoice(storage, "f95.sort", "nope", ["titleAsc"]), false);
  assert.equal(storage.getItem("f95.sort"), null);

  const throwing = {
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {},
  };
  assert.equal(writeStoredChoice(throwing, "k", "a", ["a"]), false);
  assert.equal(writeStoredChoice(null, "k", "a", ["a"]), false);
});
