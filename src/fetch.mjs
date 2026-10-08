#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.mjs";
import { ensureDir, loadEnv } from "./util.mjs";
import {
  cursorFetch,
  AuthError,
  handleAuthFailure,
  cookieHeaderFromJar,
  loadJar,
} from "./session.mjs";
import { parseUsageHtml, parseUsageCsv, discoverCsvUrls } from "./parse.mjs";
import {
  parseApiUsageResponse,
  formatBillingCycleLabel,
} from "./parse-api.mjs";
import {
  fetchAllFilteredUsageEvents,
  fetchUsageCsv,
  getBillingCycleMillis,
  monthChunksLastN,
  teamIdFromJar,
} from "./api.mjs";
import { loadEvents, mergeEvents } from "./store.mjs";

loadEnv();

const CHUNK_DELAY_MS = 300;

function parseFetchArgs(argv) {
  const all = argv.includes("--all");
  let months = null;
  const mi = argv.indexOf("--months");
  if (mi >= 0 && argv[mi + 1]) {
    const n = parseInt(argv[mi + 1], 10);
    if (Number.isFinite(n) && n > 0) months = n;
  }
  if (all && months != null) {
    throw new Error("Use either --all or --months N, not both");
  }
  return { all, months };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function saveRaw(name, body) {
  ensureDir(config.rawDir);
  const ext = name.endsWith(".csv") ? "csv" : "html";
  const file = path.join(config.rawDir, `${name}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

async function fetchViaDashboardApi() {
  const teamId = teamIdFromJar();
  const result = await fetchAllFilteredUsageEvents({ teamId });
  const events = parseApiUsageResponse(result.events);
  const billingCycle = formatBillingCycleLabel(result.billingCycle);
  return {
    events,
    billingCycle,
    pagination: { total: result.totalUsageEventsCount },
    source: "api",
  };
}

async function fetchMonthChunk(teamId, chunk) {
  const result = await fetchAllFilteredUsageEvents({
    teamId,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
  });
  const events = parseApiUsageResponse(result.events);
  console.log(`${chunk.label}: ${events.length} events`);
  return events;
}

async function fetchViaDashboardApiBackfill({ all, months }) {
  const teamId = teamIdFromJar();
  let events = [];

  if (months != null) {
    const chunks = monthChunksLastN(months);
    for (const chunk of chunks) {
      events = events.concat(await fetchMonthChunk(teamId, chunk));
      await sleep(CHUNK_DELAY_MS);
    }
  } else if (all) {
    let emptyStreak = 0;
    let offset = 0;
    while (emptyStreak < 2 && offset < 120) {
      const now = new Date();
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
      );
      const startMs = String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const endMs = String(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      );
      const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const batch = await fetchMonthChunk(teamId, { startMs, endMs, label });
      if (batch.length === 0) emptyStreak += 1;
      else emptyStreak = 0;
      events = events.concat(batch);
      offset += 1;
      await sleep(CHUNK_DELAY_MS);
    }
  }

  const cycle = await getBillingCycleMillis(teamId);
  const billingCycle = formatBillingCycleLabel({
    startMs: cycle.startMs,
    endMs: cycle.endMs,
  });
  return {
    events,
    billingCycle,
    pagination: { total: events.length },
    source: "api",
  };
}

async function fetchViaCsvExport() {
  const teamId = teamIdFromJar();
  const { getBillingCycleMillis } = await import("./api.mjs");
  const cycle = await getBillingCycleMillis(teamId);
  const csv = await fetchUsageCsv({
    teamId,
    startMs: cycle.startMs,
    endMs: cycle.endMs,
  });
  saveRaw("usage-export", csv);
  const parsed = parseUsageCsv(csv);
  return {
    ...parsed,
    billingCycle: formatBillingCycleLabel({
      startMs: cycle.startMs,
      endMs: cycle.endMs,
    }),
    source: "csv-export",
  };
}

async function fetchViaHtmlScrape() {
  const firstUrl = config.usageUrl;
  const { text: html1 } = await cursorFetch(firstUrl);
  saveRaw("usage-page-1", html1);

  const candidates = discoverCsvUrls(html1);
  for (let raw of candidates) {
    if (raw.startsWith("/")) raw = new URL(raw, firstUrl).toString();
    try {
      const { text } = await cursorFetch(raw, {
        headers: { Accept: "text/csv" },
      });
      if (text.includes(",") && /model|token|cost/i.test(text.slice(0, 500))) {
        return { ...parseUsageCsv(text), source: "csv-link" };
      }
    } catch {
      // continue
    }
  }

  const parsed1 = parseUsageHtml(html1);
  let allEvents = parsed1.events;
  const pagination = parsed1.pagination;
  const total = pagination?.total ?? allEvents.length;
  const pageSize = pagination ? pagination.to - pagination.from + 1 : 100;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  for (let page = 2; page <= pages; page++) {
    const u = new URL(firstUrl);
    u.searchParams.set("page", String(page));
    u.searchParams.set("pageSize", String(pageSize));
    const { text } = await cursorFetch(u.toString());
    saveRaw(`usage-page-${page}`, text);
    allEvents = allEvents.concat(parseUsageHtml(text).events);
  }

  return {
    events: allEvents,
    billingCycle: parsed1.billingCycle,
    pagination,
    source: "html",
  };
}

async function main() {
  try {
    if (!cookieHeaderFromJar(loadJar())) {
      throw new AuthError("missing cookie");
    }
    const fetchFlags = parseFetchArgs(process.argv.slice(2));
    console.log(
      fetchFlags.all || fetchFlags.months != null
        ? "Fetching Cursor usage (historical backfill)…"
        : "Fetching Cursor usage…",
    );

    let result;
    try {
      if (fetchFlags.all || fetchFlags.months != null) {
        result = await fetchViaDashboardApiBackfill(fetchFlags);
      } else {
        result = await fetchViaDashboardApi();
      }
    } catch (apiErr) {
      console.warn("Dashboard API failed, trying CSV export:", apiErr.message);
      try {
        result = await fetchViaCsvExport();
      } catch (csvErr) {
        console.warn("CSV export failed, trying HTML scrape:", csvErr.message);
        result = await fetchViaHtmlScrape();
      }
    }

    console.log(
      `Parsed ${result.events.length} events (${result.source}${result.billingCycle ? `, cycle: ${result.billingCycle}` : ""})`,
    );
    const store = loadEvents();
    const { added, total } = mergeEvents(store, result.events, {
      billingCycle: result.billingCycle,
      lastSource: result.source,
      teamId: teamIdFromJar(),
    });
    console.log(
      `Store: +${added} new, ${total} total events → ${config.eventsPath}`,
    );
  } catch (e) {
    if (e instanceof AuthError) {
      handleAuthFailure(e);
      process.exit(1);
    }
    if (e instanceof Error && /either --all or --months/i.test(e.message)) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

main();
