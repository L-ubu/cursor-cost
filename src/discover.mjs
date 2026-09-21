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

loadEnv();

async function main() {
  try {
    if (!cookieHeaderFromJar(loadJar())) {
      throw new AuthError("missing cookie");
    }
    ensureDir(config.rawDir);
    console.log(`GET ${config.usageUrl}`);
    const { response, text } = await cursorFetch(config.usageUrl);
    const out = path.join(config.rawDir, `discover-${Date.now()}.html`);
    fs.writeFileSync(out, text, "utf8");
    console.log(`Saved ${text.length} bytes → ${out}`);
    console.log(`Status: ${response.status}, final URL: ${response.url}`);

    console.log(
      "\nPrimary data source: POST /api/dashboard/get-filtered-usage-events",
    );
    console.log(
      "CSV fallback: GET /api/dashboard/export-usage-events-csv?startDate=&endDate=",
    );

    const csvUrls = discoverCsvUrls(text);
    console.log("\nCandidate CSV/export URLs in HTML:");
    if (csvUrls.length === 0)
      console.log("  (none in static HTML — dashboard loads usage via API)");
    for (const u of csvUrls) console.log(`  - ${u}`);

    for (const raw of csvUrls.slice(0, 5)) {
      const url = raw.startsWith("http")
        ? raw
        : new URL(raw, config.usageUrl).toString();
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
