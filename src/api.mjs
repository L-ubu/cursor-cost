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
