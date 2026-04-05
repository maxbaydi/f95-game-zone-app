const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIBRARY_SORT_MODES,
  getInstalledAtTimestamp,
  getStatusSortLabel,
  normalizeLibraryStatus,
  sortLibraryGames,
} = require("../src/shared/librarySort");

test("getInstalledAtTimestamp picks the newest installed version timestamp", () => {
  assert.equal(
    getInstalledAtTimestamp({
      versions: [
        { date_added: 100 },
        { date_added: 450 },
        { date_added: 320 },
      ],
    }),
    450,
  );
});

test("normalizeLibraryStatus treats blank and ongoing statuses as in development", () => {
  assert.equal(normalizeLibraryStatus(""), "inDevelopment");
  assert.equal(normalizeLibraryStatus(null), "inDevelopment");
  assert.equal(normalizeLibraryStatus("Ongoing"), "inDevelopment");
  assert.equal(normalizeLibraryStatus("Onhold"), "onHold");
  assert.equal(normalizeLibraryStatus("Completed"), "completed");
  assert.equal(normalizeLibraryStatus("Abandoned"), "abandoned");
});

test("getStatusSortLabel turns blank status into a user-facing in-development label", () => {
  assert.equal(getStatusSortLabel({ status: "" }), "In development");
});

test("sortLibraryGames sorts by newest install date first", () => {
  const orderedTitles = sortLibraryGames(
    [
      { title: "Older", versions: [{ date_added: 50 }] },
      { title: "Newest", versions: [{ date_added: 400 }] },
      { title: "Middle", versions: [{ date_added: 200 }] },
    ],
    LIBRARY_SORT_MODES.INSTALLED_NEWEST,
  ).map((game) => game.title);

  assert.deepEqual(orderedTitles, ["Newest", "Middle", "Older"]);
});

test("sortLibraryGames sorts by engine and keeps unknown engines last", () => {
  const orderedTitles = sortLibraryGames(
    [
      { title: "Unknown Engine", engine: "" },
      { title: "Unity Title", engine: "Unity" },
      { title: "Renpy Title", engine: "Ren'Py" },
    ],
    LIBRARY_SORT_MODES.ENGINE,
  ).map((game) => game.title);

  assert.deepEqual(orderedTitles, [
    "Renpy Title",
    "Unity Title",
    "Unknown Engine",
  ]);
});

test("sortLibraryGames sorts by normalized status groups", () => {
  const orderedTitles = sortLibraryGames(
    [
      { title: "Abandoned Game", status: "Abandoned" },
      { title: "Hold Game", status: "Onhold" },
      { title: "Dev Game", status: "" },
      { title: "Complete Game", status: "Completed" },
    ],
    LIBRARY_SORT_MODES.STATUS,
  ).map((game) => game.title);

  assert.deepEqual(orderedTitles, [
    "Dev Game",
    "Hold Game",
    "Complete Game",
    "Abandoned Game",
  ]);
});
