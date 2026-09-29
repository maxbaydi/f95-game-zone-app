// Compiles every renderer .jsx file with the same Babel build the app uses at
// runtime, so a syntax error is caught by `npm run lint` instead of at startup.
const fs = require("fs");
const path = require("path");
const Babel = require("@babel/standalone");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "vendor") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".jsx")) {
      out.push(full);
    }
  }
  return out;
}

let failed = 0;
for (const file of walk(path.join(__dirname, "..", "src"))) {
  try {
    Babel.transform(fs.readFileSync(file, "utf8"), {
      presets: ["react"],
      filename: file,
    });
  } catch (error) {
    failed += 1;
    console.error(`${path.relative(process.cwd(), file)}: ${error.message}`);
  }
}
if (failed) {
  process.exit(1);
}
console.log("jsx ok");
