import { config } from "../config.mjs";
import { cursorFetch, loadJar } from "./session.mjs";

function dashboardHeaders() {
  const stored = loadJar();
  const csrf = stored.cookies["csrf-token"]?.value;
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Referer: config.usageUrl,
    Origin: "https://cursor.com",
    ...(csrf ? { "x-portal-csrf-token": csrf } : {}),
  };
}

export async function dashboardPost(path, body) {
  const url = path.startsWith("http") ? path : `https://cursor.com${path}`;
  const { response, text } = await cursorFetch(url, {
    method: "POST",
    headers: dashboardHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${path}: ${text.slice(0, 200)}`);
  }
  if (json?.error?.message) {
    throw new Error(json.error.message);
  }
  return { response, json };
}

export async function getBillingCycleMillis(teamId) {
  const { json } = await dashboardPost(
    "/api/dashboard/get-current-billing-cycle",
    {},
  );
  if (json.startDateEpochMillis && json.endDateEpochMillis) {
    return {
      startMs: String(json.startDateEpochMillis),
      endMs: String(json.endDateEpochMillis),
    };
  }
  const { json: monthly } = await dashboardPost(
    "/api/dashboard/get-monthly-billing-cycle",
    {
      teamId: teamId ? String(teamId) : undefined,
    },
  );
  return {
    startMs: String(monthly.startDateEpochMillis),
    endMs: String(monthly.endDateEpochMillis),
  };
}

export function teamIdFromJar() {
  const stored = loadJar();
  return (
    stored.cookies["portal-selected-team-id"]?.value ||
    stored.cookies["team_id"]?.value ||
    process.env.CURSOR_TEAM_ID
  );
}

/** @returns {{ startMs: string, endMs: string, label: string }[]} */
export function monthChunksBetween(startMs, endMs) {
  const rangeStart = Number(startMs);
  const rangeEnd = Number(endMs);
  /** @type {{ startMs: string, endMs: string, label: string }[]} */
  const chunks = [];
  const start = new Date(rangeStart);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const end = new Date(rangeEnd);
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();

  while (y < endY || (y === endY && m <= endM)) {
    const startOfMonth = Date.UTC(y, m, 1);
    const endOfMonth = Date.UTC(y, m + 1, 0, 23, 59, 59, 999);
    const label = `${y}-${String(m + 1).padStart(2, "0")}`;
    chunks.push({
      startMs: String(Math.max(startOfMonth, rangeStart)),
      endMs: String(Math.min(endOfMonth, rangeEnd)),
      label,
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return chunks;
}

/** Last N calendar months including the current month (UTC), oldest first. */
export function monthChunksLastN(n) {
  const count = Math.max(1, Math.floor(Number(n)) || 1);
  const now = new Date();
  const rangeEnd = now.getTime();
  const rangeStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - (count - 1),
    1,
  );
  return monthChunksBetween(rangeStart, rangeEnd);
}

export async function fetchFilteredUsagePage({
  teamId,
  startMs,
  endMs,
  page,
  pageSize,
}) {
  const body = {
    startDate: startMs,
    endDate: endMs,
    page,
    pageSize,
    ...(teamId ? { teamId: String(teamId) } : {}),
  };
  const { json } = await dashboardPost(
    "/api/dashboard/get-filtered-usage-events",
    body,
  );
  return json;
}

export async function fetchAllFilteredUsageEvents(options = {}) {
  const teamId = options.teamId ?? teamIdFromJar();
  const cycle = options.startMs
    ? { startMs: options.startMs, endMs: options.endMs }
    : await getBillingCycleMillis(teamId);

  const pageSize = options.pageSize ?? 100;
  let page = 1;
  let total = Infinity;
  /** @type {object[]} */
  const all = [];

  while (all.length < total) {
    const json = await fetchFilteredUsagePage({
      teamId,
      startMs: cycle.startMs,
      endMs: cycle.endMs,
      page,
      pageSize,
    });
    total = Number(json.totalUsageEventsCount ?? 0);
    const batch = json.usageEventsDisplay ?? [];
    all.push(...batch);
    if (!batch.length) break;
    page++;
    if (page > 500) break;
  }

  return {
    events: all,
    totalUsageEventsCount: total,
    billingCycle: {
      startMs: cycle.startMs,
      endMs: cycle.endMs,
    },
    teamId,
  };
}

export async function fetchUsageCsv({ teamId, startMs, endMs }) {
  const params = new URLSearchParams({
    startDate: startMs,
    endDate: endMs,
  });
  if (teamId) params.set("teamId", String(teamId));
  const url = `https://cursor.com/api/dashboard/export-usage-events-csv?${params}`;
  const { text } = await cursorFetch(url, {
    headers: {
      Accept: "text/csv",
      Referer: config.usageUrl,
    },
  });
  return text;
}
