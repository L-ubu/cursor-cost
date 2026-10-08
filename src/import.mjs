#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.mjs";
import { parseUsageCsv } from "./parse.mjs";
import { loadTeamEvents, mergeEvents } from "./store.mjs";
import { formatUsd } from "./table.mjs";

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: cursor-cost import <team-usage.csv>");
    console.error(
      "Export the CSV from the cursor.com dashboard usage page, then import it here.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const text = fs.readFileSync(file, "utf8");
  const { events } = parseUsageCsv(text);
  if (!events.length) {
    console.error("No usage events parsed from that file.");
    process.exit(1);
  }

  const store = loadTeamEvents();
  const { added, total } = mergeEvents(
    store,
    events,
    { lastImportFrom: path.basename(file) },
    config.teamEventsPath,
  );

  const byUser = {};
  for (const e of store.events) {
    const u = e.user || "unknown";
    byUser[u] ||= { rows: 0, od: 0 };
    byUser[u].rows++;
    if (e.type === "On-Demand" && e.costUsd != null) byUser[u].od += e.costUsd;
  }

  console.log(
    `Imported ${path.basename(file)}: +${added} new, ${total} total team events → ${config.teamEventsPath}`,
  );
  for (const [u, v] of Object.entries(byUser).sort((a, b) => b[1].od - a[1].od)) {
    console.log(`  ${u}: ${v.rows} rows, on-demand ${formatUsd(v.od)}`);
  }
  console.log("Run: cursor-cost team");
}

main();
