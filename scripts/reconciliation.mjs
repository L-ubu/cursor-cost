#!/usr/bin/env node
/**
 * Print scope totals for comparing with finance / work numbers.
 */
import { loadEnv } from "../src/util.mjs";
import { loadEvents } from "../src/store.mjs";
import { filterEventsByBillingCycle } from "../src/scope.mjs";
import {
  fetchAllFilteredUsageEvents,
  getBillingCycleMillis,
  teamIdFromJar,
} from "../src/api.mjs";
import { parseApiUsageResponse } from "../src/parse-api.mjs";

loadEnv();

function sumOnDemand(events) {
  return events.reduce((a, e) => {
    if (e.type === "On-Demand" && e.costUsd != null) return a + e.costUsd;
    return a;
  }, 0);
}

function byCalendarMonth(events) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const e of events) {
    if (e.type !== "On-Demand" || e.costUsd == null) continue;
    const key = e.timestamp.slice(0, 7);
    m[key] = (m[key] || 0) + e.costUsd;
  }
  return m;
}

async function liveCurrentCycleOd() {
  const teamId = teamIdFromJar();
  const cycle = await getBillingCycleMillis(teamId);
  const result = await fetchAllFilteredUsageEvents({
    teamId,
    startMs: cycle.startMs,
    endMs: cycle.endMs,
  });
  const parsed = parseApiUsageResponse(result.events);
  return {
    od: sumOnDemand(parsed),
    events: parsed.length,
    label: `${cycle.startMs} .. ${cycle.endMs}`,
  };
}

async function main() {
  const { events, meta } = loadEvents();
  const { events: cycleEvents } = filterEventsByBillingCycle(events, meta);
  const allOd = sumOnDemand(events);
  const cycleOd = sumOnDemand(cycleEvents);
  const months = byCalendarMonth(events);

  console.log("\n=== cursor-cost reconciliation ===\n");
  console.log("Store meta billing cycle:", meta.billingCycle || "(none)");
  console.log(
    "Current cycle (scoped, local store):",
    `$${cycleOd.toFixed(2)}`,
    `(${cycleEvents.length} events)`,
  );
  console.log(
    "All-time (local store):",
    `$${allOd.toFixed(2)}`,
    `(${events.length} events)`,
  );
  console.log("\nCalendar month on-demand (UTC, local store):");
  for (const [mo, usd] of Object.entries(months).sort()) {
    console.log(`  ${mo}: $${usd.toFixed(2)}`);
  }

  try {
    const live = await liveCurrentCycleOd();
    console.log("\nLive API (current billing cycle, fresh fetch):");
    console.log(`  On-Demand: $${live.od.toFixed(2)} (${live.events} events)`);
    const drift = Math.abs(live.od - cycleOd);
    if (drift > 0.05) {
      console.log(
        `  Note: store differs by $${drift.toFixed(2)}; run cursor-cost fetch`,
      );
    }
  } catch (e) {
    console.log("\nLive API: skipped (" + e.message + ")");
  }

  console.log(`
Compare with work using the same scope:
  · Dashboard "Cost" per row = usageBasedCosts (what this tool sums).
  · CSV export "Requests" is not USD; do not use it for on-demand dollars.
  · chargedCents can include token fees; may differ from usageBasedCosts.
  · Seat / Business plan fee and VAT may not appear in usage events.
  · Invoice timing can lag the billing cycle shown on cursor.com.
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
