const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectPreferredExecutable,
} = require("../src/main/install/selectExecutable");

test("selectPreferredExecutable prefers the game executable over generic runtimes", () => {
  const selected = selectPreferredExecutable(
    [
      "lib/windows-x86_64/pythonw.exe",
      "renpy/renpy.exe",
      "Apartment69.exe",
    ],
    { title: "Apartment #69", creator: "Luxee" },
  );

  assert.equal(selected, "Apartment69.exe");
});

test("selectPreferredExecutable prefers shallower title-matching executables", () => {
  const selected = selectPreferredExecutable(
    [
      "Bonus/Apartment69.exe",
      "Apartment69-0.11-pc/Apartment69.exe",
    ],
    { title: "Apartment #69", creator: "Luxee" },
  );

  assert.equal(selected, "Apartment69-0.11-pc/Apartment69.exe");
});
