#!/usr/bin/env node
import {
  filterEventsByBillingCycle,
  projectionForCycle,
} from "../src/scope.mjs";

const meta = {
  billingCycle: "Sep 30, 2026 - Oct 31, 2026",
  billingCycleStartMs: String(Date.UTC(2026, 8, 30, 12, 0, 0)),
  billingCycleEndMs: String(Date.UTC(2026, 9, 31, 12, 0, 0)),
};

const events = [
  {
    timestamp: new Date(Date.UTC(2026, 8, 15)).toISOString(),
    type: "On-Demand",
    model: "a",
    tokens: 100,
    costUsd: 100,
  },
  {
    timestamp: new Date(Date.UTC(2026, 9, 5)).toISOString(),
    type: "On-Demand",
    model: "b",
    tokens: 200,
    costUsd: 10,
  },
  {
    timestamp: new Date(Date.UTC(2026, 9, 6)).toISOString(),
    type: "Included",
    model: "c",
    tokens: 50,
    costUsd: null,
  },
];

const errors = [];
const { events: cycle, legacyMeta } = filterEventsByBillingCycle(events, meta);
if (legacyMeta) errors.push("expected legacyMeta false");
if (cycle.length !== 2)
  errors.push(`expected 2 cycle events, got ${cycle.length}`);
const od = cycle
  .filter((e) => e.type === "On-Demand")
  .reduce((a, e) => a + (e.costUsd || 0), 0);
if (Math.abs(od - 10) > 0.001) errors.push("cycle on-demand sum");

const nowMs = Date.UTC(2026, 9, 7);
const proj = projectionForCycle(10, cycle, meta, nowMs);
if (proj.activeDays !== 2) errors.push("activeDays");
if (!proj.cycleScoped) errors.push("cycleScoped");

const { events: all, legacyMeta: leg2 } = filterEventsByBillingCycle(
  events,
  {},
);
if (!leg2 || all.length !== 3) errors.push("legacy fallback");

if (errors.length) {
  console.error("VERIFY REPORT FAILED:\n", errors.join("\n"));
  process.exit(1);
}
console.log("Report scope verify OK");
