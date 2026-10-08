/**
 * Billing cycle scoping and projection helpers (pure, testable).
 */

export function filterEventsByBillingCycle(events, meta) {
  const startMs = meta?.billingCycleStartMs;
  const endMs = meta?.billingCycleEndMs;
  if (startMs == null || endMs == null || startMs === "" || endMs === "") {
    return { events, legacyMeta: true };
  }
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { events, legacyMeta: true };
  }
  const filtered = events.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t >= start && t <= end;
  });
  return { events: filtered, legacyMeta: false };
}

function utcDay(iso) {
  return iso.slice(0, 10);
}

/** Days from startMs through effectiveEndMs (inclusive calendar days, UTC). */
export function cycleLengthDays(startMs, endMs, nowMs = Date.now()) {
  const start = Number(startMs);
  const end = Number(endMs);
  const effectiveEnd = Math.min(nowMs, end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    effectiveEnd < start
  ) {
    return { elapsedDays: 1, totalDays: 1 };
  }
  const startDay = utcDay(new Date(start).toISOString());
  const endDay = utcDay(new Date(end).toISOString());
  const effectiveDay = utcDay(new Date(effectiveEnd).toISOString());
  const dayMs = 86400000;
  const totalDays = Math.max(
    1,
    Math.round(
      (new Date(endDay + "T00:00:00.000Z").getTime() -
        new Date(startDay + "T00:00:00.000Z").getTime()) /
        dayMs,
    ) + 1,
  );
  const elapsedDays = Math.max(
    1,
    Math.round(
      (new Date(effectiveDay + "T00:00:00.000Z").getTime() -
        new Date(startDay + "T00:00:00.000Z").getTime()) /
        dayMs,
    ) + 1,
  );
  return { elapsedDays, totalDays };
}

export function projectionForCycle(
  onDemandTotal,
  cycleEvents,
  meta,
  nowMs = Date.now(),
) {
  const startMs = meta?.billingCycleStartMs;
  const endMs = meta?.billingCycleEndMs;
  const days = new Set(cycleEvents.map((e) => utcDay(e.timestamp)));
  const activeDays = days.size || 1;
  const avg = onDemandTotal / activeDays;

  if (startMs == null || endMs == null) {
    const now = new Date(nowMs);
    const lastDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const dayOfMonth = now.getUTCDate();
    return {
      avg,
      projected: avg * lastDay,
      dayOfMonth,
      lastDay,
      activeDays,
      cycleScoped: false,
    };
  }

  const { elapsedDays, totalDays } = cycleLengthDays(startMs, endMs, nowMs);
  const projected = avg * totalDays;
  const now = new Date(nowMs);
  return {
    avg,
    projected,
    dayOfMonth: elapsedDays,
    lastDay: totalDays,
    activeDays,
    cycleScoped: true,
  };
}
