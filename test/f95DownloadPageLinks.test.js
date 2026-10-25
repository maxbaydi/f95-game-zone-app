/**
 * F95 download page links (`/dl/<post>/?u&k&r&t`) that replaced masked links
 * in thread starter posts (2026-10). Fixtures in test/fixtures/f95/download-page
 * are trimmed, anonymised copies of the live pages.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { normalizeThreadDownloadLinks } = require("../src/main/f95/threadLinks");
const { getMirrorHostInfo, prepareMirrorDownload } = require("../src/main/f95/hosts");
const {
  decodeF95DownloadCode,
  parseF95DownloadPageLink,
  resolveF95DownloadPage,
} = require("../src/main/f95/hosts/f95");
const {
  MirrorActionRequiredError,
  MirrorError,
  createResolverContext,
} = require("../src/main/f95/hosts/common");
const { isF95MaskedUrl, resolveMirrorWithFallback } = require("../src/main/f95/mirrorFallback");
const {
  createF95LinkRefresher,
  findFreshF95DownloadLink,
  prepareWithFreshF95Link,
} = require("../src/main/f95/downloadLinkRefresh");
const { createMockResponse, createRoutedSession, noSleep } = require("./helpers/mockFetch");

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", "f95", "download-page", name), "utf8");
const dl = (key, renderedAt = 1700000000, post = 100) =>
  `https://f95zone.to/dl/${post}/?u=1000&k=${key}&r=${renderedAt}&t=Tok${renderedAt}`;
const LINK = dl("abcdef123456");
const html = (url, body, status = 200) => createMockResponse({ url, status, body });
const line = "Win: BUZZHEAVIER - DATANODES - PIXELDRAIN - AKIRABOX";
const raw = (url, label, faviconHost, extra = {}) => ({
  url, label, faviconHost, lineText: line, contextText: line, order: 0, ...extra,
});

test("thread links: /dl/ links are mirrors, host from the label first, then the favicon", () => {
  const { links, variants } = normalizeThreadDownloadLinks([
    raw(dl("aaa"), "BUZZHEAVIER", "bzzhr.to", { order: 1 }),
    raw(dl("bbb"), "PIXELDRAIN", "pixeldrain.com", { order: 2 }),
    raw(dl("ccc"), "AKIRABOX", "akirabox.com", { order: 3 }),
    raw(dl("ddd"), "GDRIVE1", "drive.google.com", { order: 4 }),
  ]);
  assert.deepEqual(links.map((link) => link.host), [
    "buzzheavier.com", "pixeldrain.com", "akirabox.com", "drive.google.com",
  ]);
  assert.equal(links[0].hostLabel, "Buzzheavier");
  assert.equal(links[1].support, "auto");
  assert.equal(links[3].hostLabel, "Google Drive");
  assert.equal(variants.length, 1);
  assert.equal(variants[0].label, "Windows");
});

test("thread links: hidden trap links never become mirrors", () => {
  const { links } = normalizeThreadDownloadLinks([
    raw(dl("trap"), "DATANODES", "datanodes.to", { isHidden: true }),
    raw(dl("real"), "DATANODES", "datanodes.to", { order: 1 }),
  ]);
  assert.deepEqual(links.map((link) => link.url), [dl("real")]);
});

test("thread links: favicon of F95 itself or an unlabeled extras line is not a host", () => {
  const extras = "Extras: Guide - Supporter Unlock";
  const { links } = normalizeThreadDownloadLinks([
    raw(dl("guide"), "Guide", "gofile.io", { lineText: extras, contextText: extras }),
    raw(dl("self"), "Mirror", "f95zone.to"),
    raw("https://f95zone.to/threads/x.1/post-2", "Supporter Unlock", "f95zone.to"),
  ]);
  assert.equal(links.length, 0);
});

test("host info: a /dl/ link is described by its host hint", () => {
  const plain = getMirrorHostInfo(LINK);
  assert.equal(plain.hostId, "f95-dl");
  assert.equal(plain.masked, true);
  const hinted = getMirrorHostInfo(LINK, { hostHint: "pixeldrain.com" });
  assert.equal(hinted.label, "Pixeldrain");
  assert.equal(hinted.masked, true);
  assert.equal(getMirrorHostInfo("https://gofile.io/d/x", { hostHint: "mega.nz" }).label, "Gofile");
});

test("link parsing: post id and link key survive a re-render, the token does not matter", () => {
  assert.deepEqual(parseF95DownloadPageLink(LINK), {
    postId: "100", key: "abcdef123456", renderedAt: 1700000000,
  });
  assert.equal(parseF95DownloadPageLink("https://f95zone.to/masked/mega.nz/1/2/3"), null);
  assert.equal(parseF95DownloadPageLink("https://example.com/dl/100/?k=abc"), null);
  assert.equal(decodeF95DownloadCode("cMzIxY2JBZWRvQ3RzZVQuMDAwMDAwMDA3MQ=="), "1700000000.TestCodeAbc123");
  assert.equal(decodeF95DownloadCode("c!!not-base64"), "");
});

function downloadPageSession(postHandler, getBody = fixture("check.html")) {
  return createRoutedSession([
    [(url, options) => url === LINK && options.method === "GET", (url) => html(url, getBody)],
    [(url, options) => url === LINK && options.method === "POST", postHandler],
  ]);
}

test("resolver: submits the page's form after the script check and returns the host URL", async () => {
  const session = downloadPageSession((url) => html(url, fixture("go.html")));
  const waits = [];
  const ctx = createResolverContext({
    session,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  const target = await resolveF95DownloadPage(ctx, LINK);
  assert.equal(target, "https://pixeldrain.com/u/TestFile1");
  const post = session.calls.find((call) => call.method === "POST");
  const fields = Object.fromEntries(new URLSearchParams(post.body));
  assert.deepEqual(fields, {
    _xfToken: "1700000000,0123456789abcdef0123456789abcdef",
    had_check: "0",
    w: "1700000000.TestCodeAbc123",
  });
  assert.match(post.headers["content-type"], /application\/x-www-form-urlencoded/);
  assert.equal(post.headers.referer, LINK);
  assert.ok(waits.some((ms) => ms > 1000), "the server wants more than one second");
});

test("resolver: a redirect or a meta refresh to the host works too", async () => {
  const redirect = downloadPageSession((url) =>
    createMockResponse({ url, status: 303, headers: { location: "https://mega.nz/file/X#k" } }));
  assert.equal(
    await resolveF95DownloadPage(createResolverContext({ session: redirect, sleep: noSleep }), LINK),
    "https://mega.nz/file/X#k",
  );
  const metaOnly = fixture("go.html").replace(/data-url="[^"]*"/, "").replace(/<a href="https:\/\/pixeldrain[^>]*>/, "<a>");
  const refresh = downloadPageSession((url) => html(url, metaOnly));
  assert.equal(
    await resolveF95DownloadPage(createResolverContext({ session: refresh, sleep: noSleep }), LINK),
    "https://pixeldrain.com/u/TestFile1",
  );
});

test("resolver: whole chain /dl/ → Pixeldrain gives a direct transfer", async () => {
  const session = createRoutedSession([
    [(url, options) => url === LINK && options.method === "GET", (url) => html(url, fixture("check.html"))],
    [(url, options) => url === LINK && options.method === "POST", (url) => html(url, fixture("go.html"))],
    [/pixeldrain\.com\/api\/file\/TestFile1\/info/, (url) =>
      createMockResponse({ url, json: { success: true, name: "game.zip", size: 42 } })],
  ]);
  const prepared = await prepareMirrorDownload(session, LINK, { sleep: noSleep });
  assert.equal(prepared.requestedUrl, LINK);
  assert.match(prepared.resolvedUrl, /pixeldrain\.com\/api\/file\/TestFile1/);
  assert.equal(prepared.fileName, "game.zip");
  assert.equal(prepared.hostLabel, "Pixeldrain");
});

test("resolver: an expired link is a typed error, not a retryable one", async () => {
  const session = createRoutedSession([[LINK, (url) => html(url, fixture("expired.html"))]]);
  const error = await resolveF95DownloadPage(createResolverContext({ session, sleep: noSleep }), LINK)
    .catch((caught) => caught);
  assert.ok(error instanceof MirrorError);
  assert.equal(error.code, "link_expired");
  assert.equal(error.retryable, false);
  assert.match(error.userMessage, /expired/i);
  assert.equal(session.calls.length, 1, "nothing is posted for an expired link");
});

test("resolver: a captcha on the check page opens the browser step on the /dl/ page", async () => {
  const withCaptcha = fixture("check.html").replace(
    '<div class="block-row">',
    '<div class="block-row"><div class="cf-turnstile" data-sitekey="x"></div>',
  );
  const session = downloadPageSession(() => assert.fail("must not post"), withCaptcha);
  const error = await resolveF95DownloadPage(createResolverContext({ session, sleep: noSleep }), LINK)
    .catch((caught) => caught);
  assert.ok(error instanceof MirrorActionRequiredError);
  assert.equal(error.code, "captcha_required");
  assert.equal(error.actionUrl, LINK);
});

test("resolver: the check page coming back again is retryable", async () => {
  const session = downloadPageSession((url) => html(url, fixture("check.html")));
  const error = await resolveF95DownloadPage(createResolverContext({ session, sleep: noSleep }), LINK)
    .catch((caught) => caught);
  assert.ok(error instanceof MirrorError);
  assert.equal(error.retryable, true);
});

test("fallback: a captcha on an F95 /dl/ link gates every F95 mirror and stops the chain", async () => {
  assert.equal(isF95MaskedUrl(LINK), true);
  const tried = [];
  const result = await resolveMirrorWithFallback({
    candidates: [{ url: LINK, host: "pixeldrain.com", label: "PIXELDRAIN" }, { url: dl("other"), host: "mega.nz", label: "MEGA" }],
    prepare: async (url) => {
      tried.push(url);
      throw new MirrorActionRequiredError("captcha", { code: "captcha_required", actionUrl: url });
    },
  });
  assert.deepEqual(tried, [LINK]);
  assert.equal(result.actionFailure.candidate.url, LINK);
});

test("refresh: the fresh link is found by post id and link key", () => {
  const fresh = dl("abcdef123456", 1700009999);
  const links = [{ url: dl("other", 1700009999) }, { url: fresh }, { url: dl("abcdef123456", 1700009999, 200) }];
  assert.equal(findFreshF95DownloadLink(LINK, links), fresh);
  assert.equal(findFreshF95DownloadLink(LINK, [{ url: dl("other") }]), "");
  assert.equal(findFreshF95DownloadLink("https://pixeldrain.com/u/x", links), "");
});

test("refresh: an expired link is swapped once for the thread's fresh one", async () => {
  const fresh = dl("abcdef123456", 1700009999);
  let inspections = 0;
  const refresher = createF95LinkRefresher({
    threadUrl: "https://f95zone.to/threads/example.100/",
    inspectThread: async () => {
      inspections += 1;
      return { success: true, links: [{ url: fresh }, { url: dl("second", 1700009999) }] };
    },
  });
  const expired = new MirrorError("expired", { code: "link_expired" });
  const prepare = async (url) => {
    if (url.includes("r=1700000000")) {
      throw expired;
    }
    return { requestedUrl: url };
  };
  const swaps = [];
  const prepared = await prepareWithFreshF95Link(LINK, prepare, refresher, (stale, next) => swaps.push([stale, next]));
  assert.equal(prepared.requestedUrl, fresh);
  assert.deepEqual(swaps, [[LINK, fresh]]);
  await prepareWithFreshF95Link(dl("second"), prepare, refresher);
  assert.equal(inspections, 1, "the thread is read once per run");
});

test("refresh: other errors and missing fresh links keep the original error", async () => {
  const refresher = createF95LinkRefresher({ threadUrl: "", inspectThread: async () => assert.fail("no thread") });
  const expired = new MirrorError("expired", { code: "link_expired" });
  await assert.rejects(prepareWithFreshF95Link(LINK, async () => { throw expired; }, refresher), expired);
  const offline = createF95LinkRefresher({
    threadUrl: "https://f95zone.to/threads/example.100/",
    inspectThread: async () => { throw new Error("offline"); },
  });
  await assert.rejects(prepareWithFreshF95Link(LINK, async () => { throw expired; }, offline), expired);
  const notFound = new MirrorError("gone", { code: "not_found" });
  await assert.rejects(prepareWithFreshF95Link(LINK, async () => { throw notFound; }, offline), notFound);
});
