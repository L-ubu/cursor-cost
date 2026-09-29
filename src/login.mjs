#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.mjs";
import { ensureDir, writeJson } from "./util.mjs";

const LOGIN_URL = "https://cursor.com/dashboard/usage";
const SESSION_COOKIE = "WorkosCursorSessionToken";
// Required alongside the session cookie, or the dashboard bootstrap 307-loops.
const SYNCED_USER_COOKIE = "cursor-web-target-synced-user";
const TIMEOUT_MS = 5 * 60 * 1000;

async function launchBrowser(chromium) {
  // Drive an installed browser — no 100MB playwright download.
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      return await chromium.launch({ channel, headless: false });
    } catch {
      // try next channel
    }
  }
  return chromium.launch({ headless: false });
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    console.error("playwright-core is missing. Run: npm install");
    process.exit(1);
  }

  console.log("Opening a browser window — log in to Cursor there.");
  console.log("Cookies are captured automatically once you're in.\n");

  const browser = await launchBrowser(chromium);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL).catch(() => {});

  const deadline = Date.now() + TIMEOUT_MS;
  /** @type {import('playwright-core').Cookie[] | null} */
  let captured = null;

  while (Date.now() < deadline) {
    let cookies;
    try {
      cookies = await context.cookies("https://cursor.com");
    } catch {
      console.error("\nBrowser closed before login completed.");
      process.exit(1);
    }
    const hasSession = cookies.some((c) => c.name === SESSION_COOKIE && c.value);
    const hasSynced = cookies.some((c) => c.name === SYNCED_USER_COOKIE && c.value);
    if (hasSession && hasSynced) {
      captured = cookies;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  await browser.close().catch(() => {});

  if (!captured) {
    console.error("Timed out waiting for login (5 min). Run `cursor-cost login` again.");
    process.exit(1);
  }

  const header = captured.map((c) => `${c.name}=${c.value}`).join("; ");

  // 1. Seed file (transparency + manual re-seed path)
  ensureDir(config.home);
  const envPath = path.join(config.home, ".env");
  fs.writeFileSync(envPath, `CURSOR_SESSION_COOKIE=${header}\n`, { encoding: "utf8", mode: 0o600 });

  // 2. Write the cookie jar directly so it takes over immediately
  const jar = { cookies: {}, updatedAt: new Date().toISOString() };
  for (const c of captured) {
    jar.cookies[c.name] = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires ? new Date(c.expires * 1000).toISOString() : undefined,
    };
  }
  writeJson(config.sessionPath, jar);
  try {
    fs.chmodSync(config.sessionPath, 0o600);
  } catch {
    // best effort
  }

  // 3. Verify the session actually works before declaring victory
  process.stdout.write("Verifying session… ");
  try {
    const { getBillingCycleMillis, teamIdFromJar } = await import("./api.mjs");
    const cycle = await getBillingCycleMillis(teamIdFromJar());
    const start = new Date(Number(cycle.startMs)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const end = new Date(Number(cycle.endMs)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    console.log("OK");
    console.log(`\nLogged in. Billing cycle: ${start} - ${end}`);
    console.log(`Cookie jar: ${config.sessionPath}`);
    console.log(`\nRun \`cursor-cost\` for your report.`);
  } catch (e) {
    console.log("FAILED");
    console.error(`\nCookies captured but the API rejected them: ${e.message}`);
    console.error("Try `cursor-cost login` again.");
    process.exit(1);
  }
}

main();
