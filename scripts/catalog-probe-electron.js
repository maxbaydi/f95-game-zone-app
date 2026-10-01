/* eslint-disable no-console */
/**
 * Catalog probe: records what the F95 "Latest Updates" data endpoint really
 * answers, so the catalog sync (the replacement for the external Atlas feed)
 * can be written against real responses instead of guesses.
 *
 * Runs inside Electron with the app's own session (`persist:f95-auth`), so
 * the F95 login made in F95Launcher is reused. Close F95Launcher first: the
 * profile must not be shared.
 *
 * Usage:
 *   npm run catalog:probe -- [--pages 2] [--rows 90] [--out test/fixtures/f95/catalog]
 *                            [--cookies cookies.txt] [--user-data <dir>]
 *
 * What is saved (one file per request, plus manifest.json with status codes):
 *   latest_alpha.html             the page that hosts the Latest Updates app
 *   latest_alpha.<asset>.js       scripts of that page (prefix/tag definitions live there)
 *   list-games-<sort>-page-N.json the paginated game list, pretty-printed
 *   meta-<cmd>.json               other commands of the same endpoint that answered
 *   thread-<id>.html              the first listed thread, for the thread fields
 *
 * Review the files before committing them: csrf tokens and the account name
 * are redacted, but have a look anyway.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, session: electronSession } = require("electron");

const ROOT = path.resolve(__dirname, "..");
const core = require("./check-mirrors");
const { F95_AUTH_PARTITION } = require(path.join(ROOT, "src/main/f95/session"));
const { createElectronResolverSession } = require(path.join(ROOT, "src/main/f95/electronSession"));

const F95_BASE = "https://f95zone.to";
const LATEST_PAGE = `${F95_BASE}/sam/latest_alpha/`;
const LATEST_DATA = `${F95_BASE}/sam/latest_alpha/latest_data.php`;
const PAUSE_MS = 1500;

function takeOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return { value: fallback, argv };
  }
  const value = argv[index + 1];
  return { value, argv: [...argv.slice(0, index), ...argv.slice(index + 2)] };
}

function scriptArgv() {
  const argv = process.argv.slice(1);
  const scriptIndex = argv.findIndex((entry) => /catalog-probe-electron\.js$/i.test(entry));
  return argv.slice(scriptIndex >= 0 ? scriptIndex + 1 : 0).filter((entry) => entry !== "--");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Remove what must not land in the repository. */
function redact(text) {
  return String(text)
    .replace(/data-csrf="[^"]*"/g, 'data-csrf="REDACTED"')
    .replace(/_xfToken=[^&"'\s]+/g, "_xfToken=REDACTED")
    .replace(/"csrf"\s*:\s*"[^"]*"/g, '"csrf":"REDACTED"')
    .replace(/(<a[^>]*p-navgroup-link--user[^>]*>)[\s\S]*?(<\/a>)/g, "$1REDACTED$2")
    .replace(/xf_session=[^;"'\s]+/g, "xf_session=REDACTED");
}

async function importCookies(session, cookies) {
  let imported = 0;
  for (const cookie of cookies) {
    const url = `https://${cookie.domain.replace(/^\./, "")}${cookie.path || "/"}`;
    try {
      await session.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.hostOnly ? undefined : `.${cookie.domain.replace(/^\./, "")}`,
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        ...(cookie.expirationDate > 0 ? { expirationDate: cookie.expirationDate } : {}),
      });
      imported += 1;
    } catch (error) {
      console.warn(`[cookies] could not import ${cookie.name} for ${cookie.domain}: ${error.message}`);
    }
  }
  return imported;
}

function createRecorder(outDir, resolverSession) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { recordedAt: new Date().toISOString(), requests: [] };

  async function record(name, url, options = {}) {
    const entry = { name, url, status: 0, contentType: "", bytes: 0, sha256: "", file: "", note: "" };
    manifest.requests.push(entry);
    try {
      const headers = {
        accept: options.json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,*/*",
        referer: LATEST_PAGE,
      };
      if (options.json) {
        headers["x-requested-with"] = "XMLHttpRequest";
      }
      const response = await resolverSession.fetch(url, { headers, redirect: "follow" });
      const buffer = Buffer.from(await response.arrayBuffer());
      entry.status = response.status;
      entry.contentType = response.headers.get("content-type") || "";
      entry.bytes = buffer.length;
      entry.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const text = buffer.toString("utf8");
      let body = redact(text);
      let extension = options.json ? "json" : "html";
      if (options.json) {
        try {
          body = `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
        } catch {
          extension = "txt";
          entry.note = "not JSON";
        }
      } else if (/\.js$/i.test(name)) {
        extension = "js";
      }
      const file = `${name}.${extension}`;
      fs.writeFileSync(path.join(outDir, file), body, "utf8");
      entry.file = file;
      console.log(`${String(entry.status).padStart(3)}  ${name}  ${entry.bytes} bytes  ${entry.contentType}`);
      return { status: entry.status, text, buffer };
    } catch (error) {
      entry.note = error instanceof Error ? error.message : String(error);
      console.log(`ERR  ${name}  ${entry.note}`);
      return { status: 0, text: "", buffer: Buffer.alloc(0) };
    } finally {
      fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await sleep(PAUSE_MS);
    }
  }

  return { record, manifest };
}

function summarizeList(text) {
  try {
    const parsed = JSON.parse(text);
    const container = parsed?.msg && typeof parsed.msg === "object" ? parsed.msg : parsed;
    const rows = Array.isArray(container?.data)
      ? container.data
      : Array.isArray(container)
        ? container
        : Array.isArray(parsed?.data)
          ? parsed.data
          : [];
    const first = rows[0] || null;
    return {
      topLevelKeys: Object.keys(parsed || {}),
      rows: rows.length,
      firstRowKeys: first && typeof first === "object" ? Object.keys(first) : [],
      pagination: container?.pagination ?? parsed?.pagination ?? null,
      threadId: first?.thread_id ?? first?.id ?? first?.threadId ?? null,
    };
  } catch {
    return null;
  }
}

async function main() {
  let argv = scriptArgv();
  const userData = takeOption(argv, "--user-data", "");
  argv = userData.argv;
  const cookiesFile = takeOption(argv, "--cookies", "");
  argv = cookiesFile.argv;
  const pages = takeOption(argv, "--pages", "2");
  argv = pages.argv;
  const rows = takeOption(argv, "--rows", "90");
  argv = rows.argv;
  const out = takeOption(argv, "--out", path.join(ROOT, "test", "fixtures", "f95", "catalog"));
  argv = out.argv;

  app.setPath("userData", userData.value || path.join(app.getPath("appData"), "f95launcher"));
  app.setAppUserModelId("com.maxbaydi.f95launcher.probe");
  if (!app.requestSingleInstanceLock()) {
    console.error("F95Launcher (or another tool) is running with this profile. Close it first.");
    return 3;
  }
  await app.whenReady();

  const session = electronSession.fromPartition(F95_AUTH_PARTITION);
  if (cookiesFile.value) {
    const cookies = core.loadCookies(cookiesFile.value, ["f95zone.to"]);
    console.log(`imported ${await importCookies(session, cookies)} cookie(s) into ${F95_AUTH_PARTITION}`);
  }
  const resolverSession = createElectronResolverSession(session);
  const f95Cookies = await resolverSession.cookies.get({ url: `${F95_BASE}/` });
  const loggedIn = f95Cookies.some((cookie) => cookie.name === "xf_user");
  console.log(`session: ${F95_AUTH_PARTITION} in ${app.getPath("userData")} (logged in: ${loggedIn})`);
  if (!loggedIn) {
    console.error("No F95 login in this profile. Sign in inside F95Launcher first, or pass --cookies cookies.txt.");
    return 2;
  }

  const outDir = path.resolve(out.value);
  const { record, manifest } = createRecorder(outDir, resolverSession);
  console.log(`writing to ${outDir}`);

  // 1. The host page and its scripts: prefix / tag definitions and the exact
  //    query the page itself sends.
  const page = await record("latest_alpha", LATEST_PAGE);
  const scriptUrls = new Set();
  for (const match of page.text.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const src = match[1];
    if (/latest_alpha|\/sam\//i.test(src) && !/jquery|bootstrap/i.test(src)) {
      scriptUrls.add(new URL(src, LATEST_PAGE).toString());
    }
  }
  let scriptIndex = 0;
  for (const scriptUrl of scriptUrls) {
    scriptIndex += 1;
    const base = path.basename(new URL(scriptUrl).pathname).replace(/[^A-Za-z0-9_.-]/g, "_").replace(/\.js$/i, "");
    await record(`latest_alpha.${scriptIndex}-${base}.js`, scriptUrl);
  }

  // 2. The paginated list, newest first, plus the other sort orders once.
  const pageCount = Math.max(1, Number.parseInt(pages.value, 10) || 2);
  const rowCount = Math.max(1, Number.parseInt(rows.value, 10) || 90);
  let firstThreadId = null;
  for (let index = 1; index <= pageCount; index += 1) {
    const url = `${LATEST_DATA}?cmd=list&cat=games&page=${index}&rows=${rowCount}&sort=date`;
    const result = await record(`list-games-date-page-${index}`, url, { json: true });
    const summary = summarizeList(result.text);
    if (summary) {
      console.log(`     keys=${summary.topLevelKeys.join(",")} rows=${summary.rows} pagination=${JSON.stringify(summary.pagination)}`);
      console.log(`     row keys=${summary.firstRowKeys.join(",")}`);
      if (firstThreadId === null && summary.threadId !== null) {
        firstThreadId = summary.threadId;
      }
    }
  }
  for (const sort of ["likes", "title"]) {
    await record(`list-games-${sort}-page-1`, `${LATEST_DATA}?cmd=list&cat=games&page=1&rows=${rowCount}&sort=${sort}`, { json: true });
  }
  // A page far beyond the end shows how the endpoint reports "no more".
  await record("list-games-date-page-beyond", `${LATEST_DATA}?cmd=list&cat=games&page=100000&rows=${rowCount}&sort=date`, { json: true });
  // A search, to see whether the same endpoint can look a title up.
  await record("list-games-search", `${LATEST_DATA}?cmd=list&cat=games&page=1&rows=${rowCount}&sort=date&search=${encodeURIComponent("the")}`, { json: true });

  // 3. Other commands the page may use for definitions.
  for (const cmd of ["cat", "prefixes", "tags", "meta", "info"]) {
    await record(`meta-${cmd}`, `${LATEST_DATA}?cmd=${cmd}`, { json: true });
  }

  // 4. One thread page, for the fields a thread adds (overview, screenshots).
  if (firstThreadId !== null) {
    await record(`thread-${firstThreadId}`, `${F95_BASE}/threads/${firstThreadId}/`);
  }

  const ok = manifest.requests.filter((entry) => entry.status === 200).length;
  console.log(`\ndone: ${ok}/${manifest.requests.length} requests answered 200; see ${path.join(outDir, "manifest.json")}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
    app.quit();
  },
  (error) => {
    console.error("catalog probe crashed:", error);
    process.exitCode = 1;
    app.quit();
  },
);
