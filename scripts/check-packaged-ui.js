// Validate actual packaged assets, not just a successful electron-builder exit.
const path = require("node:path");
const asar = require("@electron/asar");
const archive = path.resolve(process.argv[2] || "dist/win-unpacked/resources/app.asar");
const entries = new Set(asar.listPackage(archive).map((entry) => entry.replace(/\\/g, "/").replace(/^\//, "")));
const windows = ["src/index.html", "src/settings.html", "src/core/ui/windows/importer.html"];
let checked = 0;
for (const entry of windows) {
  const html = asar.extractFile(archive, path.normalize(entry)).toString("utf8");
  if (/text\/babel|vendor\/babel/.test(html)) throw new Error(`Runtime JSX compiler in ${entry}`);
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:[a-z]+:|#)/i.test(match[1])) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry), match[1].split(/[?#]/)[0]));
    if (!entries.has(target)) throw new Error(`${entry} references missing packaged asset: ${target}`);
    checked++;
  }
}
console.log(`Packaged UI: ${windows.length} windows, ${checked} asset references verified.`);
