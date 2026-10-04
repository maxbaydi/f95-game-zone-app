const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatReport,
  parseArgs,
  summarizeReleases,
} = require("../scripts/usage-stats");

const asset = (name, count) => ({ name, download_count: count });

test("installers and update checks are counted apart, blockmaps and drafts skipped", () => {
  const summary = summarizeReleases([
    {
      tag_name: "v1.8.2",
      published_at: "2026-10-01T13:04:59Z",
      assets: [
        asset("F95Launcher-Setup-1.8.2.exe", 6),
        asset("F95Launcher-Setup-1.8.2.exe.blockmap", 5),
        asset("F95Launcher-1.8.2.AppImage", 1),
        asset("f95launcher_1.8.2_amd64.deb", 1),
        asset("latest.yml", 44),
        asset("latest-linux.yml", 1),
      ],
    },
    { tag_name: "v1.9.0", draft: true, assets: [asset("latest.yml", 3)] },
    { tag_name: "v1.8.1", published_at: null, assets: [] },
  ]);
  assert.deepEqual(summary, {
    releases: [
      { tag: "v1.8.2", date: "2026-10-01", installers: 8, updateChecks: 45 },
      { tag: "v1.8.1", date: "", installers: 0, updateChecks: 0 },
    ],
    installers: 8,
    updateChecks: 45,
  });
});

test("options come from the environment and can be overridden by flags", () => {
  const env = {
    F95LAUNCHER_STATS_URL: "https://stats.example/",
    F95LAUNCHER_STATS_TOKEN: "t",
  };
  assert.deepEqual(parseArgs([], env), {
    repo: "maxbaydi/f95-game-zone-app",
    url: "https://stats.example",
    token: "t",
    githubToken: "",
    days: 30,
    json: false,
  });
  const flagged = parseArgs(["--days", "9999", "--json", "--url", "https://other.example"], env);
  assert.equal(flagged.days, 366);
  assert.equal(flagged.json, true);
  assert.equal(flagged.url, "https://other.example");
  assert.throws(() => parseArgs(["--nope"], env), /Unknown option/);
});

test("the report says how to enable the user counter when it is not configured", () => {
  const text = formatReport({
    downloads: summarizeReleases([
      { tag_name: "v1.8.2", published_at: "2026-10-01", assets: [asset("a.exe", 3)] },
    ]),
    usage: null,
    usageConfigured: false,
  });
  assert.match(text, /Установщики всего:\s+3/);
  assert.match(text, /F95LAUNCHER_STATS_URL/);
});

test("the report lists users, versions and the last days", () => {
  const text = formatReport({
    downloads: null,
    downloadsError: "GitHub answered HTTP 403",
    usageConfigured: true,
    usage: {
      totals: { installs: 120, active1d: 30, active7d: 70, active30d: 95, new30d: 40 },
      versions: [{ name: "1.9.0", users: 80 }],
      platforms: [{ name: "win32 x64", users: 90 }],
      countries: [],
      daily: [{ day: "2026-10-04", active: 30, new: 2 }],
    },
  });
  assert.match(text, /HTTP 403/);
  assert.match(text, /Установок всего:\s+120/);
  assert.match(text, /За 30 дней:\s+95/);
  assert.match(text, /1\.9\.0 — 80/);
  assert.match(text, /Страны \(30 дней\):\s+нет данных/);
  assert.match(text, /2026-10-04\s+30\s+2/);
});
