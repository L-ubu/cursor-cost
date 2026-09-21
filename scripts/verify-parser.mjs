#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUsageHtml } from "../src/parse.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(
  path.join(root, "test/fixtures/sample-usage.html"),
  "utf8",
);
const { events, billingCycle, pagination } = parseUsageHtml(html);

const errors = [];
if (events.length !== 2) errors.push(`expected 2 events, got ${events.length}`);
if (!billingCycle?.includes("Aug 31")) errors.push("billing cycle not parsed");
if (pagination?.total !== 131) errors.push("pagination total mismatch");
if (events[0]?.tokens !== 128100) errors.push("token parse 128.1K failed");
if (events[1]?.tokens !== 5600000) errors.push("token parse 5.6M failed");
if (events[1]?.costUsd !== 2.34) errors.push("cost parse failed");

if (errors.length) {
  console.error("VERIFY FAILED:\n", errors.join("\n"));
  process.exit(1);
}
console.log("Parser verify OK (fixture matches expected dashboard row shape).");
