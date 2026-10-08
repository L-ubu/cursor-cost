#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUsageCsv } from "../src/parse.mjs";
import { mergeEvents } from "../src/store.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const csv = fs.readFileSync(
  path.join(root, "test/fixtures/sample-team-usage.csv"),
  "utf8",
);
const { events } = parseUsageCsv(csv);

const errors = [];
if (events.length !== 5) errors.push(`expected 5 events, got ${events.length}`);

const od = events.filter((e) => e.type === "On-Demand");
const odSum = od.reduce((a, e) => a + (e.costUsd ?? 0), 0);
if (od.length !== 4) errors.push(`expected 4 on-demand, got ${od.length}`);
if (Math.abs(odSum - 2.57) > 0.001)
  errors.push(`on-demand sum ${odSum.toFixed(2)} != 2.57`);
if (events[0]?.user !== "teammate@example.com")
  errors.push(`user not preserved: ${events[0]?.user}`);
const inc = events.find((e) => e.type === "Included");
if (!inc || inc.costUsd != null) errors.push("included row should have null cost");
if (events[0]?.tokens !== 131363)
  errors.push(`tokens parse failed: ${events[0]?.tokens}`);

// Dedupe: merging the same file twice adds nothing the second time.
const tmpStore = path.join(
  os.tmpdir(),
  `cursor-cost-verify-import-${process.pid}.json`,
);
try {
  const fresh = { version: 1, events: [], meta: {} };
  const first = mergeEvents(fresh, events, {}, tmpStore);
  if (first.added !== 5) errors.push(`first merge added ${first.added}, want 5`);
  const second = mergeEvents(fresh, events, {}, tmpStore);
  if (second.added !== 0)
    errors.push(`re-import added ${second.added}, want 0 (dedupe)`);
} finally {
  fs.rmSync(tmpStore, { force: true });
}

if (errors.length) {
  console.error("VERIFY IMPORT FAILED:\n", errors.join("\n"));
  process.exit(1);
}
console.log("Import verify OK (team CSV parses, costs sum, re-import dedupes).");
