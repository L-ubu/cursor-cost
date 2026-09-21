import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function loadEnv() {
  loadEnvFile(path.join(process.cwd(), ".env"));
  loadEnvFile(
    path.join(os.homedir(), ".cursor-cost", ".env"),
  );
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

export function parseTokenCount(raw) {
  if (raw == null || raw === "" || raw === "—" || raw === "-") return 0;
  const s = String(raw).replace(/,/g, "").trim();
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return Number(s) || 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || "").toUpperCase();
  if (u === "K") return Math.round(n * 1e3);
  if (u === "M") return Math.round(n * 1e6);
  if (u === "B") return Math.round(n * 1e9);
  return Math.round(n);
}

export function parseCostUsd(raw) {
  if (raw == null || raw === "" || raw === "—" || raw === "-") return null;
  const s = String(raw).trim().replace("$", "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function notifyMac(title, message) {
  const safe = (t) => String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'display notification "${safe(message)}" with title "${safe(title)}"'`,
      { stdio: "ignore" },
    );
  } catch {
    // ignore
  }
}

export function printAuthHelp() {
  console.error(`
Session expired or missing. Fix in ~30 seconds:

  1. Open https://cursor.com/dashboard/usage (logged in)
  2. DevTools → Network → reload → pick the usage document request
  3. Copy the full Cookie header (or paste into .env as CURSOR_SESSION_COOKIE=)
  4. Run: npm run fetch

The cookie jar at data/session.json will take over after the next successful fetch.
`);
}
