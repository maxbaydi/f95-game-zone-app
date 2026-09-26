/**
 * Form extraction must survive real-world markup: forms mentioned inside
 * HTML comments, unclosed <form> tags and nested forms. Fixture captured from
 * datanodes.to on 2026-09-26, where a commented-out "<form>" made the parser
 * submit the real download form as GET.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  MirrorActionRequiredError,
  extractAnchors,
  extractHtmlForms,
} = require("../src/main/f95/hosts/common");
const { prepareMirrorDownload } = require("../src/main/f95/hosts");
const { createMockResponse, createRoutedSession, noSleep } = require("./helpers/mockFetch");

const DATANODES_PAGE = fs.readFileSync(
  path.join(__dirname, "fixtures", "hosts", "datanodes", "download-page-op1.html"),
  "utf8",
);

test("a <form> inside an HTML comment is ignored", () => {
  const forms = extractHtmlForms(DATANODES_PAGE, "https://datanodes.to/download");
  assert.equal(forms.length, 1);
  assert.equal(forms[0].id, "downloadForm");
  assert.equal(forms[0].method, "POST");
  assert.equal(forms[0].action, "https://datanodes.to/download");
  assert.deepEqual(forms[0].fields, {
    op: "download1",
    usr_login: "",
    id: "ce5r2yfycezq",
    fname: "girl_by_accident_0.8.7.zip",
    referer: "",
  });
});

test("an unclosed <form> does not swallow the forms that follow it", () => {
  const html = `
    <form action="/search"><input name="q" value=""></form>
    <form id="broken" method="get">
      <input name="ignored" value="1">
    <form id="real" method="post" action="/go">
      <input type="hidden" name="op" value="download2">
      <input type="hidden" name="id" value="abc">
    </form>`;
  const forms = extractHtmlForms(html, "https://host.test/page");
  assert.deepEqual(
    forms.map((form) => [form.id, form.method, form.action, form.fields]),
    [
      ["", "GET", "https://host.test/search", { q: "" }],
      ["broken", "GET", "https://host.test/page", { ignored: "1" }],
      ["real", "POST", "https://host.test/go", { op: "download2", id: "abc" }],
    ],
  );
});

test("anchors inside comments are ignored too", () => {
  const html = `<!-- <a href="/x/old.zip">old</a> --><a href="/x/new.zip">new</a>`;
  const anchors = extractAnchors(html, "https://host.test/");
  assert.deepEqual(
    anchors.map((anchor) => anchor.url),
    ["https://host.test/x/new.zip"],
  );
});

const DATANODES_PAGE_2 = fs.readFileSync(
  path.join(__dirname, "fixtures", "hosts", "datanodes", "download-page-op2-turnstile.html"),
  "utf8",
);

test("DataNodes: the free-download form is POSTed; the Turnstile-gated countdown asks for the browser", async () => {
  const calls = [];
  const session = createRoutedSession([
    [
      "https://datanodes.to/ce5r2yfycezq/girl_by_accident_0.8.7.zip",
      () => createMockResponse({ url: "https://datanodes.to/download", body: DATANODES_PAGE }),
    ],
    [
      "https://datanodes.to/download",
      (url, options) => {
        calls.push(options);
        assert.equal(options.method, "POST", "the real form is POSTed, not sent as a GET query");
        const body = String(options.body || "");
        assert.match(body, /op=download1/);
        assert.match(body, /id=ce5r2yfycezq/);
        assert.match(body, /method_free=/);
        return createMockResponse({ url, body: DATANODES_PAGE_2 });
      },
    ],
  ]);

  await assert.rejects(
    prepareMirrorDownload(
      session,
      "https://datanodes.to/ce5r2yfycezq/girl_by_accident_0.8.7.zip",
      { sleep: noSleep, retry: { attempts: 1 } },
    ),
    (/** @type {any} */ error) =>
      error instanceof MirrorActionRequiredError &&
      error.code === "captcha_required" &&
      error.actionUrl === "https://datanodes.to/ce5r2yfycezq/girl_by_accident_0.8.7.zip",
  );
  assert.equal(calls.length, 1, "no retry loop on the same page");
});

test("DataNodes: without the captcha the countdown answer is followed to the file", async () => {
  // The component repeats the attribute; every copy must say false.
  const pageWithoutCaptcha = DATANODES_PAGE_2.replaceAll(':has-captcha="true"', ':has-captcha="false"');
  const session = createRoutedSession([
    [
      "https://datanodes.to/ce5r2yfycezq/girl_by_accident_0.8.7.zip",
      () => createMockResponse({ url: "https://datanodes.to/download", body: DATANODES_PAGE }),
    ],
    [
      "https://datanodes.to/download",
      (url, options) => {
        const body = String(options.body || "");
        if (/op=download1/.test(body)) {
          return createMockResponse({ url, body: pageWithoutCaptcha });
        }
        assert.match(body, /op=download2/);
        assert.match(body, /rand=crv5gxorkktn3acj6rurhgw52bhstjhyhb2ihhc6vi/);
        return createMockResponse({
          url,
          json: { url: "https://n3.datanodes.to/d/xyz/girl_by_accident_0.8.7.zip" },
        });
      },
    ],
  ]);

  const prepared = await prepareMirrorDownload(
    session,
    "https://datanodes.to/ce5r2yfycezq/girl_by_accident_0.8.7.zip",
    { sleep: noSleep, retry: { attempts: 1 } },
  );
  assert.equal(prepared.resolvedUrl, "https://n3.datanodes.to/d/xyz/girl_by_accident_0.8.7.zip");
  assert.equal(prepared.headers.referer, "https://datanodes.to/download");
});
