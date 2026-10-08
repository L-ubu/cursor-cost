import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./src/util.mjs";

loadEnv();

const root = path.dirname(fileURLToPath(import.meta.url));

// Data home works the same for a repo checkout and a global npm install.
const home =
  process.env.CURSOR_COST_HOME || path.join(os.homedir(), ".cursor-cost");

// One-time migration: move a repo-local data/ directory into the data home.
const legacyData = path.join(root, "data");
if (fs.existsSync(legacyData) && !fs.existsSync(path.join(home, "data"))) {
  fs.mkdirSync(home, { recursive: true });
  fs.renameSync(legacyData, path.join(home, "data"));
}

export const USAGE_URL = "https://cursor.com/dashboard/usage";

export const config = {
  usageUrl: USAGE_URL,
  timezone: "Europe/Brussels",
  monthlyBudgetUsd: Number(process.env.CURSOR_MONTHLY_BUDGET_USD ?? 50),
  root,
  home,
  dataDir: path.join(home, "data"),
  sessionPath: path.join(home, "data", "session.json"),
  eventsPath: path.join(home, "data", "events.json"),
  teamEventsPath: path.join(home, "data", "team-events.json"),
  rawDir: path.join(home, "data", "raw"),
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
