// Compile JSX before Electron opens a window. Keep the same classic-script
// semantics as Babel's former browser transform, without its startup cost.
const fs = require("node:fs");
const path = require("node:path");
const Babel = require("@babel/standalone");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const ENTRIES = ["index.html", "settings.html", "core/ui/windows/importer.html"];

function rendererSources() {
  const sources = new Map();
  for (const entry of ENTRIES) {
    const htmlPath = path.join(SRC, entry);
    const html = fs.readFileSync(htmlPath, "utf8");
    for (const script of html.matchAll(/<script\b[^>]*\bdata-source="([^"]+)"[^>]*>/g)) {
      const src = script[0].match(/\ssrc="([^"]+)"/);
      if (!src) throw new Error(`Missing output path in ${entry}`);
      const input = path.resolve(path.dirname(htmlPath), script[1]);
      const output = path.resolve(path.dirname(htmlPath), src[1]);
      if (!input.startsWith(`${SRC}${path.sep}`) || !output.startsWith(`${path.join(SRC, "assets", "compiled")}${path.sep}`)) {
        throw new Error(`Renderer path escapes the build directories: ${entry}`);
      }
      sources.set(input, output);
    }
  }
  return sources;
}

function compile(input, output) {
  const result = Babel.transform(fs.readFileSync(input, "utf8"), {
    presets: ["react", ["env", { modules: false }]],
    filename: path.relative(SRC, input),
    sourceMaps: false,
    comments: false,
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // These are reproducible build artifacts, never user data. Finish writing
  // before the launcher starts; in watch mode reload after "rebuilt".
  fs.writeFileSync(output, result.code);
}

function buildRenderer() {
  const sources = rendererSources();
  for (const [input, output] of sources) compile(input, output);
  return sources;
}

if (require.main === module) {
  const sources = buildRenderer();
  console.log(`renderer: compiled ${sources.size} scripts`);
  if (process.argv.includes("--watch")) {
    let timer;
    fs.watch(SRC, { recursive: true }, (event, file) => {
      if (!file || !sources.has(path.resolve(SRC, String(file)))) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          buildRenderer();
          console.log("renderer: rebuilt");
        } catch (error) {
          console.error("renderer:", error.message);
        }
      }, 120);
    });
  }
}

module.exports = { buildRenderer, rendererSources };
