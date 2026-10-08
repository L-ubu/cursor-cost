#!/usr/bin/env node
import { loadTeamEvents } from "./store.mjs";
import { c } from "./colors.mjs";
import { formatUsd, formatTokens, printTable, sectionTitle } from "./table.mjs";

function onDemandCost(ev) {
  if (ev.type === "On-Demand" && ev.costUsd != null) return ev.costUsd;
  return 0;
}

function main() {
  const { events, meta } = loadTeamEvents();
  if (!events.length) {
    console.log(
      "No team data. Export the team usage CSV from cursor.com and run: cursor-cost import <file.csv>",
    );
    process.exit(0);
  }

  const byUser = {};
  for (const e of events) {
    const u = e.user || "unknown";
    byUser[u] ||= { rows: 0, tokens: 0, od: 0 };
    byUser[u].rows++;
    byUser[u].tokens += e.tokens || 0;
    byUser[u].od += onDemandCost(e);
  }

  const teamTotal = Object.values(byUser).reduce((a, v) => a + v.od, 0);
  const rows = Object.entries(byUser)
    .sort((a, b) => b[1].od - a[1].od)
    .map(([u, v]) => [
      u,
      String(v.rows),
      formatTokens(v.tokens),
      v.od > 0 ? c.brightRed(formatUsd(v.od)) : c.dim(formatUsd(v.od)),
      `${((v.od / (teamTotal || 1)) * 100).toFixed(1)}%`,
    ]);

  console.log();
  console.log(
    `${c.dim("Team events:")} ${c.brightWhite(String(events.length))}  ${c.dim("│")}  ${c.dim("Team on-demand:")} ${c.bold(c.brightRed(formatUsd(teamTotal)))}`,
  );
  if (meta.lastImportFrom)
    console.log(`${c.dim("Last import:")} ${meta.lastImportFrom}`);

  console.log(sectionTitle("By user"));
  printTable(["User", "Rows", "Tokens", "On-Demand", "% OD"], rows);

  const byMonth = {};
  for (const e of events) {
    const mo = e.timestamp.slice(0, 7);
    byMonth[mo] ||= { rows: 0, od: 0 };
    byMonth[mo].rows++;
    byMonth[mo].od += onDemandCost(e);
  }
  const monthRows = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mo, v]) => [c.brightCyan(mo), String(v.rows), c.brightRed(formatUsd(v.od))]);
  console.log(sectionTitle("By month (UTC)"));
  printTable(["Month", "Rows", "On-Demand"], monthRows);
}

main();
