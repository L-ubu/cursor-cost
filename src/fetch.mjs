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
  teamIdFromJar,
} from "./api.mjs";
import { loadEvents, mergeEvents } from "./store.mjs";

loadEnv();

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
    console.log("Fetching Cursor usage…");

    let result;
    try {
      result = await fetchViaDashboardApi();
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
    throw e;
  }
}

main();
