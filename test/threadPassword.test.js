const test = require("node:test");
const assert = require("node:assert/strict");

const { extractArchivePassword } = require("../src/main/f95/threadPassword");

test("extracts archive passwords in the usual spellings", () => {
  assert.equal(extractArchivePassword("Overview\nDownload:\nMEGA PIXELDRAIN\nPassword: f95zone"), "f95zone");
  assert.equal(extractArchivePassword("PW - Game2026!\nEnjoy"), "Game2026!");
  assert.equal(extractArchivePassword("Archive password: `secret-pass`"), "secret-pass");
  assert.equal(extractArchivePassword("Unzip password is \"hello world\"".replace(" world", "")), "hello");
  assert.equal(extractArchivePassword("Пароль от архива: f95zone.to"), "f95zone.to");
  assert.equal(extractArchivePassword("**Password**: MyGame_v1"), "MyGame_v1");
});

test("takes the value from the next line when the label stands alone", () => {
  assert.equal(extractArchivePassword("Password:\n\nf95zone\n\nChangelog"), "");
  assert.equal(extractArchivePassword("Password:\nf95zone\nChangelog"), "f95zone");
  assert.equal(extractArchivePassword("Password: protected\nf95zone"), "f95zone");
});

test("ignores text that only mentions passwords", () => {
  assert.equal(extractArchivePassword("The archive is password protected, see the link below."), "");
  assert.equal(extractArchivePassword("No password required."), "");
  assert.equal(extractArchivePassword("Password: https://example.com/file.zip"), "");
  assert.equal(extractArchivePassword(""), "");
  assert.equal(extractArchivePassword(null), "");
});
