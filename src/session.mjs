import { config } from "../config.mjs";
import {
  readJson,
  writeJson,
  loadEnv,
  printAuthHelp,
  notifyMac,
} from "./util.mjs";

loadEnv();

/** @typedef {{ name: string, value: string, domain?: string, path?: string, expires?: string }} CookieEntry */

function parseCookieHeader(header) {
  /** @type {Record<string, CookieEntry>} */
  const jar = {};
  if (!header?.trim()) return jar;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name) jar[name] = { name, value };
  }
  return jar;
}

function parseSetCookie(setCookie) {
  const [pair] = setCookie.split(";");
  const eq = pair.indexOf("=");
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const entry = { name, value };
  for (const attr of setCookie.split(";").slice(1)) {
    const [k, ...rest] = attr.trim().split("=");
    const key = k?.toLowerCase();
    const v = rest.join("=").trim();
    if (key === "domain") entry.domain = v;
    if (key === "path") entry.path = v;
    if (key === "expires") entry.expires = v;
  }
  return entry;
}

function mergeSetCookies(jar, setCookieHeaders) {
  for (const sc of setCookieHeaders) {
    const entry = parseSetCookie(sc);
    if (!entry?.name) continue;
    if (entry.value === "" || /^deleted$/i.test(entry.value)) {
      delete jar[entry.name];
    } else {
      jar[entry.name] = entry;
    }
  }
  return jar;
}

export function loadJar() {
  /** @type {{ cookies: Record<string, CookieEntry>, updatedAt?: string }} */
  let stored = readJson(config.sessionPath, { cookies: {} });
  if (!stored.cookies) stored = { cookies: {} };

  // .env is a one-time seed for an EMPTY jar. Once the jar has cookies it owns
  // renewal via Set-Cookie rotation — re-applying a stale .env would clobber
  // rotated values. To re-seed after a dead session: `cursor-cost login`.
  const seed = process.env.CURSOR_SESSION_COOKIE?.trim();
  if (seed && Object.keys(stored.cookies).length === 0) {
    stored.cookies = parseCookieHeader(seed);
    stored.updatedAt = new Date().toISOString();
    writeJson(config.sessionPath, stored);
  }

  return stored;
}

export function saveJar(stored) {
  stored.updatedAt = new Date().toISOString();
  writeJson(config.sessionPath, stored);
}

export function cookieHeaderFromJar(stored) {
  return Object.values(stored.cookies)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export function applyResponseCookies(stored, response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  if (raw.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) raw.push(single);
  }
  if (raw.length) {
    stored.cookies = mergeSetCookies(stored.cookies, raw);
    saveJar(stored);
  }
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

export function assertAuthenticated(response, finalUrl) {
  if (response.status === 401) {
    throw new AuthError("HTTP auth failure");
  }
  const url = finalUrl || response.url;
  if (
    /login|sign-in|authenticate/i.test(url) &&
    !/\/dashboard\/usage/.test(url)
  ) {
    throw new AuthError("Redirected to login");
  }
}

export function handleAuthFailure(err) {
  printAuthHelp();
  notifyMac(
    "cursor-cost",
    "Cursor session expired — re-copy cookie in .env and run npm run fetch",
  );
  if (err) console.error(err.message);
}

function isRedirect(status) {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

async function fetchWithJar(stored, url, options = {}) {
  let current = url;
  let response;
  let hops = 0;
  const seen = new Set();

  while (hops < 25) {
    const cookie = cookieHeaderFromJar(stored);
    response = await fetch(current, {
      ...options,
      redirect: "manual",
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/json,text/csv,*/*",
        Cookie: cookie,
        ...options.headers,
      },
    });

    applyResponseCookies(stored, response);

    if (!isRedirect(response.status)) break;

    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, current).href;
    const hopKey = `${response.status}:${next}`;
    if (seen.has(hopKey)) {
      throw new AuthError(
        "Redirect loop (missing cursor-web-target-synced-user or expired session)",
      );
    }
    seen.add(hopKey);
    current = next;
    hops++;
  }

  if (!response) throw new AuthError("No response");
  return { response, finalUrl: current };
}

export async function cursorFetch(url, options = {}) {
  const stored = loadJar();
  const cookie = cookieHeaderFromJar(stored);
  if (!cookie) {
    throw new AuthError(
      "No session cookie — set CURSOR_SESSION_COOKIE in .env",
    );
  }

  const { response, finalUrl } = await fetchWithJar(stored, url, options);
  assertAuthenticated(response, finalUrl);

  const text = await response.text();
  if (
    text.length < 5000 &&
    (/sign in to cursor/i.test(text) || /workos.*login/i.test(text))
  ) {
    throw new AuthError("Login page in response body");
  }

  if (response.status >= 400) {
    throw new AuthError(`HTTP ${response.status}`);
  }

  return { response, text, stored };
}
