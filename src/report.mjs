#!/usr/bin/env node
import { config } from "../config.mjs";
import { loadEvents } from "./store.mjs";
import { c, padEndVisible, visibleLength, modelColor } from "./colors.mjs";

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

function filterCurrentMonth(events) {
  const now = new Date();
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return events.filter((e) => utcMonthKey(e.timestamp) === key);
}

function billingCycleEvents(events, meta) {
  if (!meta.billingCycle) return events;
  return events;
}

function projectionMtd(onDemandTotal, events) {
  const monthEvents = filterCurrentMonth(events);
  const days = new Set(monthEvents.map((e) => utcDay(e.timestamp)));
  const dayCount = days.size || 1;
  const avg = onDemandTotal / dayCount;
  const now = new Date();
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const projected = avg * lastDay;
  return { avg, projected, dayOfMonth, lastDay, activeDays: dayCount };
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

  const scoped = billingCycleEvents(events, meta);
  const onDemandTotal = sumOnDemand(scoped);
  const tokensTotal = sumTokens(scoped);
  const included = scoped.filter((e) => e.type === "Included");
  const onDemand = scoped.filter((e) => e.type === "On-Demand");
  const proj = projectionMtd(onDemandTotal, scoped);
  const budget = config.monthlyBudgetUsd;
  const budgetRatio = budget > 0 ? onDemandTotal / budget : 0;

  const report = {
    meta,
    totals: {
      events: scoped.length,
      tokens: tokensTotal,
      onDemandUsd: onDemandTotal,
      includedEvents: included.length,
      onDemandEvents: onDemand.length,
    },
    projection: proj,
    budget: { limitUsd: budget, usedRatio: budgetRatio },
    byModel: aggregateByModel(scoped),
    byDay: groupBy(scoped, utcDay),
    byWeek: groupBy(scoped, utcWeekKey),
    byMonth: groupBy(scoped, utcMonthKey),
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
  console.log();
  console.log(
    kv("Events:", c.brightWhite(String(scoped.length))) +
      c.dim("  │  ") +
      kv("Tokens:", c.brightWhite(formatTokens(tokensTotal))),
  );
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
          c.dim(` (day ${proj.dayOfMonth}/${proj.lastDay})`),
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
    const byModel = aggregateByModel(scoped);
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
    const byDay = groupBy(scoped, utcDay);
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
    const byWeek = groupBy(scoped, utcWeekKey);
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
    const byMonth = groupBy(scoped, utcMonthKey);
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
