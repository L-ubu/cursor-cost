#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.mjs";
import { ensureDir, loadEnv } from "./util.mjs";
import {
  cursorFetch,
  AuthError,
  handleAuthFailure,
  loadJar,
  cookieHeaderFromJar,
} from "./session.mjs";
import { discoverCsvUrls, parseUsageHtml } from "./parse.mjs";
import {
  fetchFilteredUsagePage,
  getBillingCycleMillis,
  teamIdFromJar,
} from "./api.mjs";

loadEnv();

async function probeDashboardApi() {
  const teamId = teamIdFromJar();
  const cycle = await getBillingCycleMillis(teamId);
  const json = await fetchFilteredUsagePage({
    teamId,
    startMs: cycle.startMs,
    endMs: cycle.endMs,
    page: 1,
    pageSize: 1,
  });
  const total = Number(json.totalUsageEventsCount ?? 0);
  console.log(
    `API probe (POST /api/dashboard/get-filtered-usage-events): OK, ${total} events in current billing cycle`,
  );
  return true;
}

async function main() {
  try {
    if (!cookieHeaderFromJar(loadJar())) {
      throw new AuthError("missing cookie");
    }
    ensureDir(config.rawDir);

    console.log(
      "Primary data source: POST /api/dashboard/get-filtered-usage-events",
    );
    console.log(
      "CSV fallback: GET /api/dashboard/export-usage-events-csv?startDate=&endDate=",
    );
    console.log();

    let apiOk = false;
    try {
      apiOk = await probeDashboardApi();
    } catch (err) {
      console.log(
        `API probe (POST /api/dashboard/get-filtered-usage-events): failed — ${err.message}`,
      );
    }

    let htmlOk = false;
    let text = "";
    let responseStatus = 0;
    let responseUrl = config.usageUrl;

    console.log(`\nGET ${config.usageUrl}`);
    try {
      const { response, text: html } = await cursorFetch(config.usageUrl);
      text = html;
      responseStatus = response.status;
      responseUrl = response.url;
      const out = path.join(config.rawDir, `discover-${Date.now()}.html`);
      fs.writeFileSync(out, text, "utf8");
      console.log(`Saved ${text.length} bytes → ${out}`);
      console.log(`Status: ${responseStatus}, final URL: ${responseUrl}`);
      htmlOk = true;
    } catch (err) {
      if (err instanceof AuthError) {
        console.log(`HTML page probe failed — ${err.message}`);
        console.log(
          "  (fetch/report can still work via the JSON API if the probe above succeeded.)",
        );
      } else {
        throw err;
      }
    }

    if (!apiOk && !htmlOk) {
      handleAuthFailure(new AuthError("Dashboard API and HTML page both failed"));
      process.exit(1);
    }

    if (!htmlOk) {
      console.log("\nSkipping HTML CSV/parse steps (page request did not succeed).");
      return;
    }

    const csvUrls = discoverCsvUrls(text);
    console.log("\nCandidate CSV/export URLs in HTML:");
    if (csvUrls.length === 0)
      console.log("  (none in static HTML — dashboard loads usage via API)");
    for (const u of csvUrls) console.log(`  - ${u}`);

    for (const raw of csvUrls.slice(0, 5)) {
      let url;
      try {
        url = raw.startsWith("http")
          ? raw
          : new URL(raw, config.usageUrl).toString();
      } catch (err) {
        console.log(`\nProbe ${JSON.stringify(raw)}: invalid URL — ${err.message}`);
        continue;
      }
      try {
        const { response: r2, text: t2 } = await cursorFetch(url, {
          headers: { Accept: "text/csv,application/json,*/*" },
        });
        const preview = t2.slice(0, 200).replace(/\n/g, "\\n");
        console.log(`\nProbe ${url}: ${r2.status}, ${t2.length} bytes`);
        console.log(`  preview: ${preview}`);
      } catch (err) {
        console.log(`\nProbe ${url}: failed — ${err.message}`);
      }
    }

    const parsed = parseUsageHtml(text);
    console.log("\nHTML parse sample:");
    console.log(`  rows: ${parsed.events.length}`);
    console.log(`  billing cycle: ${parsed.billingCycle ?? "unknown"}`);
    console.log(`  pagination: ${JSON.stringify(parsed.pagination)}`);
    if (parsed.events[0]) {
      console.log(`  first event: ${JSON.stringify(parsed.events[0])}`);
    }
  } catch (e) {
    if (e instanceof AuthError) {
      handleAuthFailure(e);
      process.exit(1);
    }
    throw e;
  }
}

main();
