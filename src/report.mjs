#!/usr/bin/env node
import { config } from "../config.mjs";
import { loadEvents } from "./store.mjs";
import { c, padEndVisible, visibleLength, modelColor } from "./colors.mjs";
import { filterEventsByBillingCycle, projectionForCycle } from "./scope.mjs";

const args = process.argv.slice(2);
const flags = {
  json: args.includes("--json"),
  week: args.includes("--week") || args[0] === "week",
  month: args.includes("--month") || args[0] === "month",
  models: args.includes("--models") || args[0] === "models",
  day: args.includes("--day") || args[0] === "day",
};

function onDemandCost(ev) {
  if (ev.type === "On-Demand" && ev.costUsd != null) return ev.costUsd;
  if (ev.type === "On-Demand" && ev.rawCost) {
    const n = parseFloat(String(ev.rawCost).replace("$", ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function sumTokens(events) {
  return events.reduce((a, e) => a + (e.tokens || 0), 0);
}

function sumOnDemand(events) {
  return events.reduce((a, e) => a + onDemandCost(e), 0);
}

function formatUsd(n) {
  return `$${n.toFixed(2)}`;
}

function formatTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function utcDay(iso) {
  return iso.slice(0, 10);
}

function utcWeekKey(iso) {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const mon = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff),
  );
  return mon.toISOString().slice(0, 10);
}

function utcMonthKey(iso) {
  return iso.slice(0, 7);
}

function groupBy(events, keyFn) {
  /** @type {Record<string, typeof events>} */
  const m = {};
  for (const e of events) {
    const k = keyFn(e.timestamp);
    (m[k] ||= []).push(e);
  }
  return m;
}

function aggregateByModel(events) {
  /** @type {Record<string, { tokens: number, onDemand: number, count: number }>} */
  const m = {};
  for (const e of events) {
    const k = e.model || "unknown";
    m[k] ||= { tokens: 0, onDemand: 0, count: 0 };
    m[k].tokens += e.tokens || 0;
    m[k].onDemand += onDemandCost(e);
    m[k].count++;
  }
  return m;
}

function budgetBarColor(ratio) {
  if (ratio >= 1) return c.brightRed;
  if (ratio >= 0.8) return c.brightYellow;
  if (ratio >= 0.5) return c.brightCyan;
  return c.brightGreen;
}

function asciiBar(ratio, width = 28) {
  const r = Math.min(1, Math.max(0, ratio));
  const filled = Math.round(r * width);
  const fill = "█".repeat(filled);
  const empty = "░".repeat(width - filled);
  const color = budgetBarColor(ratio);
  const pct = (r * 100).toFixed(0);
  return `${color(fill)}${c.dim(empty)} ${c.bold(color(`${pct}%`))}`;
}

function sectionTitle(text) {
  const line = "─".repeat(Math.max(0, 44 - visibleLength(text)));
  return `\n${c.brightMagenta("╭─")} ${c.bold(c.brightWhite(text))} ${c.brightMagenta(line + "╮")}`;
}

function printTable(headers, rows, { modelCol = -1 } = {}) {
  const widths = headers.map((h, i) =>
    Math.max(
      visibleLength(h),
      ...rows.map((r) => visibleLength(String(r[i] ?? ""))),
    ),
  );
  const border = c.dim("│");
  const headerLine = headers
    .map((h, i) => ` ${c.bold(c.brightCyan(padEndVisible(h, widths[i])))} `)
    .join(border);
  const sep = widths.map((w) => c.dim("─".repeat(w + 2))).join(c.dim("┼"));
  console.log(headerLine);
  console.log(sep);
  for (const row of rows) {
    const cells = row.map((cell, i) => {
      let s = String(cell ?? "");
      if (i === modelCol) s = modelColor(stripModelColor(s))(s);
      return ` ${padEndVisible(s, widths[i])} `;
    });
    console.log(cells.join(border));
  }
}

function stripModelColor(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function kv(label, value) {
  return `${c.dim(label)} ${value}`;
}

function main() {
  const { events, meta } = loadEvents();
  if (!events.length) {
    console.log("No events in store. Run: npm run fetch");
    process.exit(0);
  }

  const { events: cycleEvents, legacyMeta } = filterEventsByBillingCycle(
    events,
    meta,
  );
  const onDemandTotal = sumOnDemand(cycleEvents);
  const allTimeOnDemand = sumOnDemand(events);
  const tokensTotal = sumTokens(cycleEvents);
  const included = cycleEvents.filter((e) => e.type === "Included");
  const onDemand = cycleEvents.filter((e) => e.type === "On-Demand");
  const proj = projectionForCycle(onDemandTotal, cycleEvents, meta);
  const budget = config.monthlyBudgetUsd;
  const budgetRatio = budget > 0 ? onDemandTotal / budget : 0;

  const report = {
    meta,
    legacyMeta,
    totals: {
      events: cycleEvents.length,
      tokens: tokensTotal,
      onDemandUsd: onDemandTotal,
      allTimeOnDemandUsd: allTimeOnDemand,
      includedEvents: included.length,
      onDemandEvents: onDemand.length,
    },
    projection: proj,
    budget: { limitUsd: budget, usedRatio: budgetRatio },
    byModel: aggregateByModel(cycleEvents),
    byDay: groupBy(events, utcDay),
    byWeek: groupBy(events, utcWeekKey),
    byMonth: groupBy(events, utcMonthKey),
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const W = 46;
  const top = c.brightMagenta(`  ╭${"─".repeat(W)}╮`);
  const bot = c.brightMagenta(`  ╰${"─".repeat(W)}╯`);
  const title = "CURSOR COST REPORT";
  const inner = W - 2;
  const pad = Math.max(0, inner - visibleLength(title));
  const left = Math.floor(pad / 2);
  const right = pad - left;
  console.log();
  console.log(top);
  console.log(
    c.brightMagenta("  │ ") +
      " ".repeat(left) +
      c.bold(c.brightYellow(title)) +
      " ".repeat(right) +
      c.brightMagenta(" │"),
  );
  console.log(bot);
  console.log();

  if (meta.billingCycle)
    console.log(kv("Billing cycle:", c.brightCyan(meta.billingCycle)));
  if (legacyMeta) {
    console.log(
      c.dim(
        "  (Run cursor-cost fetch to scope totals to the current billing cycle.)",
      ),
    );
  }
  console.log();
  console.log(
    kv("Events:", c.brightWhite(String(cycleEvents.length))) +
      c.dim("  │  ") +
      kv("Tokens:", c.brightWhite(formatTokens(tokensTotal))),
  );
  if (events.length !== cycleEvents.length) {
    console.log(
      kv(
        "All-time store:",
        c.dim(
          `${events.length} events, on-demand ${formatUsd(allTimeOnDemand)}`,
        ),
      ),
    );
  }
  console.log();
  console.log(
    kv("On-Demand:", c.bold(c.brightRed(formatUsd(onDemandTotal)))) +
      c.dim("  │  ") +
      kv("Included rows:", c.brightGreen(String(included.length))),
  );
  console.log();
  console.log(
    kv("MTD avg/day:", c.brightYellow(formatUsd(proj.avg))) +
      c.dim("  │  ") +
      kv(
        "Projected:",
        c.brightYellow(formatUsd(proj.projected)) +
          c.dim(
            proj.cycleScoped
              ? ` (day ${proj.dayOfMonth}/${proj.lastDay} of cycle)`
              : ` (day ${proj.dayOfMonth}/${proj.lastDay})`,
          ),
      ),
  );
  console.log();

  const budgetLabel = kv("Budget", c.brightWhite(formatUsd(budget)));
  console.log(`${budgetLabel} ${asciiBar(budgetRatio)}`);
  console.log();
  if (budgetRatio >= 1) {
    console.log(
      c.bold(c.brightRed("  OVER BUDGET — spending is above your monthly cap")),
    );
  } else if (budgetRatio >= 0.8) {
    console.log(c.bold(c.brightYellow("  Over 80% of monthly budget")));
  } else {
    console.log(c.brightGreen("  Within budget"));
  }

  if (flags.models || (!flags.week && !flags.month && !flags.day)) {
    const byModel = aggregateByModel(cycleEvents);
    const totalOd = onDemandTotal || 1;
    const rows = Object.entries(byModel)
      .sort(
        (a, b) => b[1].onDemand - a[1].onDemand || b[1].tokens - a[1].tokens,
      )
      .map(([model, v]) => [
        model,
        formatTokens(v.tokens),
        v.onDemand > 0
          ? c.brightRed(formatUsd(v.onDemand))
          : c.dim(formatUsd(v.onDemand)),
        `${((v.onDemand / totalOd) * 100).toFixed(1)}%`,
        String(v.count),
      ]);
    console.log(sectionTitle("By model"));
    printTable(["Model", "Tokens", "On-Demand", "% OD", "Rows"], rows, {
      modelCol: 0,
    });
  }

  if (flags.day) {
    const byDay = groupBy(events, utcDay);
    const rows = Object.entries(byDay)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 31)
      .map(([day, evs]) => [
        c.brightCyan(day),
        formatTokens(sumTokens(evs)),
        c.brightRed(formatUsd(sumOnDemand(evs))),
        String(evs.length),
      ]);
    console.log(sectionTitle("By day (UTC)"));
    printTable(["Day", "Tokens", "On-Demand", "Rows"], rows);
  }

  if (flags.week) {
    const byWeek = groupBy(events, utcWeekKey);
    const rows = Object.entries(byWeek)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([wk, evs]) => [
        c.brightCyan(wk),
        formatTokens(sumTokens(evs)),
        c.brightRed(formatUsd(sumOnDemand(evs))),
        String(evs.length),
      ]);
    console.log(sectionTitle("By week (Mon UTC)"));
    printTable(["Week start", "Tokens", "On-Demand", "Rows"], rows);
  }

  if (flags.month) {
    const byMonth = groupBy(events, utcMonthKey);
    const rows = Object.entries(byMonth)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mo, evs]) => [
        c.brightCyan(mo),
        formatTokens(sumTokens(evs)),
        c.brightRed(formatUsd(sumOnDemand(evs))),
        String(evs.length),
      ]);
    console.log(sectionTitle("By month"));
    printTable(["Month", "Tokens", "On-Demand", "Rows"], rows);
  }
}

main();
