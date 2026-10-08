#!/usr/bin/env node
/**
 * One-off live verification against cursor.com (read-only).
 * Run: node scripts/verify-live.mjs
 */
import { loadEnv } from "../src/util.mjs";
import {
  fetchAllFilteredUsageEvents,
  getBillingCycleMillis,
  teamIdFromJar,
} from "../src/api.mjs";
import { fetchUsageCsv } from "../src/api.mjs";
import { parseApiUsageResponse } from "../src/parse-api.mjs";
import { parseUsageCsv } from "../src/parse.mjs";
import { normalizeApiUsageEvent } from "../src/parse-api.mjs";

loadEnv();

function sumOnDemand(events) {
  return events.reduce((a, e) => {
    if (e.type === "On-Demand" && e.costUsd != null) return a + e.costUsd;
    return a;
  }, 0);
}

function rowKey(ev) {
  const ts = ev.timestamp.slice(0, 19);
  return `${ts}|${ev.model}|${ev.tokens}|${ev.type}`;
}

async function verifyCycle(label, startMs, endMs) {
  const teamId = teamIdFromJar();
  const result = await fetchAllFilteredUsageEvents({
    teamId,
    startMs,
    endMs,
  });
  const total = Number(result.totalUsageEventsCount ?? 0);
  const fetched = result.events.length;
  const parsed = parseApiUsageResponse(result.events);
  const od = sumOnDemand(parsed);
  const ok = fetched === total;
  console.log(`\n=== ${label} ===`);
  console.log(`  totalUsageEventsCount: ${total}`);
  console.log(`  fetched rows:          ${fetched}`);
  console.log(`  pagination OK:         ${ok ? "YES" : "NO"}`);
  console.log(`  On-Demand sum:         $${od.toFixed(2)}`);
  return { result, parsed, total, fetched, od, ok };
}

async function main() {
  const teamId = teamIdFromJar();
  const cycle = await getBillingCycleMillis(teamId);
  console.log("teamId:", teamId);
  console.log("current cycle ms:", cycle.startMs, "->", cycle.endMs);

  const current = await verifyCycle(
    "Current billing cycle",
    cycle.startMs,
    cycle.endMs,
  );

  // Previous cycle: month before current start
  const start = Number(cycle.startMs);
  const prevEnd = start - 1;
  const prevStartDate = new Date(start);
  prevStartDate.setUTCMonth(prevStartDate.getUTCMonth() - 1);
  const prevStart = Date.UTC(
    prevStartDate.getUTCFullYear(),
    prevStartDate.getUTCMonth(),
    prevStartDate.getUTCDate(),
  );
  const previous = await verifyCycle(
    "Previous billing cycle (approx)",
    String(prevStart),
    String(prevEnd),
  );

  // CSV cross-check current cycle
  console.log("\n=== CSV vs API (current cycle) ===");
  const csvText = await fetchUsageCsv({
    teamId,
    startMs: cycle.startMs,
    endMs: cycle.endMs,
  });
  const csvParsed = parseUsageCsv(csvText);
  const apiKeys = new Set(current.parsed.map(rowKey));
  const csvKeys = new Set(csvParsed.events.map(rowKey));
  let onlyApi = 0;
  let onlyCsv = 0;
  for (const fp of apiKeys) if (!csvKeys.has(fp)) onlyApi++;
  for (const fp of csvKeys) if (!apiKeys.has(fp)) onlyCsv++;
  const csvOd = sumOnDemand(csvParsed.events);
  const csvOdRows = csvParsed.events.filter(
    (e) => e.type === "On-Demand",
  ).length;
  console.log(`  API events:  ${current.parsed.length}`);
  console.log(`  CSV events:  ${csvParsed.events.length}`);
  console.log(
    `  row key mismatches (API only / CSV only): ${onlyApi} / ${onlyCsv}`,
  );
  console.log(`  API On-Demand (usageBasedCosts): $${current.od.toFixed(2)}`);
  console.log(
    `  CSV On-Demand rows: ${csvOdRows} (export has no Cost column; Requests is not USD)`,
  );
  console.log(
    `  CSV costUsd sum: $${csvOd.toFixed(2)} (expected 0 without Cost col)`,
  );

  // Cost field fidelity on raw API rows
  console.log("\n=== Cost field fidelity (raw API) ===");
  const kinds = new Set();
  const users = new Set();
  let usageSum = 0;
  let chargedMismatch = 0;
  let parseMismatch = 0;
  for (const row of current.result.events) {
    kinds.add(row.kind);
    if (row.userEmail) users.add(row.userEmail);
    if (row.owningUser) users.add(String(row.owningUser));
    const norm = normalizeApiUsageEvent(row);
    const raw = row.usageBasedCosts;
    if (raw != null && raw !== "" && raw !== "-" && raw !== "—") {
      const s = String(raw).trim().replace("$", "");
      const n = parseFloat(s);
      if (Number.isFinite(n)) usageSum += n;
      if (
        norm.type === "On-Demand" &&
        norm.costUsd != null &&
        Math.abs(n - norm.costUsd) > 0.001
      ) {
        parseMismatch++;
      }
    }
    if (row.chargedCents != null && row.usageBasedCosts) {
      const charged = Number(row.chargedCents) / 100;
      const u = parseFloat(String(row.usageBasedCosts).replace("$", ""));
      if (Number.isFinite(u) && Math.abs(charged - u) > 0.01) chargedMismatch++;
    }
  }
  console.log("  distinct kinds:", [...kinds]);
  console.log("  distinct users:", [...users]);
  console.log("  raw usageBasedCosts sum (all rows): $" + usageSum.toFixed(2));
  console.log("  parse mismatches:", parseMismatch);
  console.log("  chargedCents vs usageBasedCosts mismatches:", chargedMismatch);

  const failures = [];
  if (!current.ok) failures.push("current cycle pagination");
  if (!previous.ok) failures.push("previous cycle pagination");
  if (current.parsed.length !== csvParsed.events.length) {
    failures.push("API/CSV event count");
  }
  if (onlyApi > 5 || onlyCsv > 5) failures.push("API/CSV row alignment");

  if (failures.length) {
    console.error("\nVERIFY LIVE FAILED:", failures.join(", "));
    process.exit(1);
  }
  console.log("\nVERIFY LIVE OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
