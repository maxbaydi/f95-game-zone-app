const test = require("node:test");
const assert = require("node:assert/strict");

const { getErrorMessage } = require("../src/main/errorMessage");

test("getErrorMessage returns native Error message", () => {
  assert.equal(getErrorMessage(new Error("boom")), "boom");
});

test("getErrorMessage returns fallback for empty Error message", () => {
  assert.equal(getErrorMessage(new Error(""), "fallback"), "fallback");
});

test("getErrorMessage handles plain string payloads", () => {
  assert.equal(getErrorMessage(" broken "), "broken");
});

test("getErrorMessage handles object payload with message field", () => {
  assert.equal(getErrorMessage({ message: "object failure" }), "object failure");
});

test("getErrorMessage handles undefined rejection payload", () => {
  assert.equal(getErrorMessage(undefined, "unknown"), "unknown");
});
