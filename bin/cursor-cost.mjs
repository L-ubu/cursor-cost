#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;
const [cmd, ...args] = process.argv.slice(2);

function run(script, scriptArgs = []) {
  const r = spawnSync(node, [path.join(root, script), ...scriptArgs], {
    stdio: "inherit",
  });
  return r.status ?? 1;
}

function help() {
  console.log(`
cursor-cost — know what Cursor is costing you

Usage:
  cursor-cost                 fetch latest usage + print report
  cursor-cost login           open a browser, capture your session automatically
  cursor-cost fetch           pull usage into the local store
  cursor-cost fetch --all     backfill all months Cursor still has
  cursor-cost fetch --months N  backfill the last N calendar months
  cursor-cost report          print report from local store (no fetch)
  cursor-cost day|week|month|models   fetch + that breakdown
  cursor-cost report --json   machine-readable output
  cursor-cost import <csv>    import a team usage CSV export (Cost column)
  cursor-cost team            per-user team breakdown from imported CSVs
  cursor-cost discover        probe the dashboard, save raw HTML
  cursor-cost install-schedule    daily 08:30 fetch (macOS launchd)
  cursor-cost uninstall-schedule  remove the launchd job
  cursor-cost --version       print version

Setup: cursor-cost login (once). Data lives in ~/.cursor-cost/.
`);
}

let code = 0;
switch (cmd) {
  case "login":
    code = run("src/login.mjs", args);
    break;
  case "fetch":
    code = run("src/fetch.mjs", args);
    break;
  case "report":
    code = run("src/report.mjs", args);
    break;
  case "import":
    code = run("src/import.mjs", args);
    break;
  case "team":
    code = run("src/team.mjs", args);
    break;
  case "discover":
    code = run("src/discover.mjs", args);
    break;
  case "--version":
  case "-v":
  case "version": {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    console.log(pkg.version);
    break;
  }
  case "install-schedule":
    code = run("scripts/install-schedule.mjs", args);
    break;
  case "uninstall-schedule":
    code = run("scripts/uninstall-schedule.mjs", args);
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  case "cost":
  case undefined: {
    code = run("src/fetch.mjs");
    if (code === 0) code = run("src/report.mjs", args);
    break;
  }
  default:
    if (["day", "week", "month", "models", "--json"].includes(cmd)) {
      code = run("src/fetch.mjs");
      if (code === 0) code = run("src/report.mjs", [cmd, ...args]);
    } else {
      console.error(`Unknown command: ${cmd}`);
      help();
      code = 1;
    }
}
process.exit(code);
