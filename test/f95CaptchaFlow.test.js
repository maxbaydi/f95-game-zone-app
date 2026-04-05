const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getCaptchaContinuationUrl,
  isMaskedF95Url,
} = require("../src/shared/f95CaptchaFlow");

test("isMaskedF95Url detects masked F95 links only", () => {
  assert.equal(
    isMaskedF95Url("https://f95zone.to/masked/abcdef/"),
    true,
  );
  assert.equal(
    isMaskedF95Url("https://drive.google.com/file/d/example/view"),
    false,
  );
});

test("getCaptchaContinuationUrl ignores the original masked action page", () => {
  const actionUrl = "https://f95zone.to/masked/abcdef/";
  assert.equal(getCaptchaContinuationUrl(actionUrl, actionUrl), "");
  assert.equal(
    getCaptchaContinuationUrl(actionUrl, "https://f95zone.to/masked/abcdef/#"),
    "",
  );
  assert.equal(
    getCaptchaContinuationUrl(actionUrl, "https://f95zone.to/"),
    "",
  );
});

test("getCaptchaContinuationUrl accepts hoster pages reached after captcha", () => {
  const actionUrl = "https://f95zone.to/masked/abcdef/";
  assert.equal(
    getCaptchaContinuationUrl(
      actionUrl,
      "https://drive.usercontent.google.com/download?id=file-id&confirm=t",
    ),
    "https://drive.usercontent.google.com/download?id=file-id&confirm=t",
  );
  assert.equal(
    getCaptchaContinuationUrl(actionUrl, "https://gofile.io/d/example"),
    "https://gofile.io/d/example",
  );
});
