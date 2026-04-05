const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const ENV_PATH = path.join(ROOT, ".env");

const DEV_WEB_PORT_KEY = "DEV_WEB_PORT";
const DEFAULT_DEV_WEB_PORT = "5173";

function loadDevWebPortFromEnvFile() {
  if (process.env[DEV_WEB_PORT_KEY]) return;
  if (!fs.existsSync(ENV_PATH)) return;
  const content = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== DEV_WEB_PORT_KEY) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[DEV_WEB_PORT_KEY] = value;
    return;
  }
}

loadDevWebPortFromEnvFile();

const portRaw = process.env[DEV_WEB_PORT_KEY] || DEFAULT_DEV_WEB_PORT;
const port = Number.parseInt(String(portRaw), 10);
if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.error(`dev-serve: invalid ${DEV_WEB_PORT_KEY}=${portRaw}`);
  process.exit(1);
}

const serveMain = path.join(ROOT, "node_modules", "serve", "build", "main.js");

const child = spawn(process.execPath, [serveMain, SRC, "-l", String(port)], {
  cwd: ROOT,
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error("dev-serve:", err);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
