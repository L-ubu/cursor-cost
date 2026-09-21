/** @typedef {import('./parse.mjs').UsageEvent} UsageEvent */

function kindToType(kind) {
  const k = String(kind || "");
  if (/ON_DEMAND|USAGE_BASED|OVERAGE/i.test(k)) return "On-Demand";
  if (/INCLUDED/i.test(k)) return "Included";
  return k.includes("INCLUDED") ? "Included" : "On-Demand";
}

function sumTokensFromUsage(tokenUsage) {
  if (!tokenUsage) return 0;
  const input = Number(tokenUsage.inputTokens ?? 0);
  const output = Number(tokenUsage.outputTokens ?? 0);
  const cache = Number(tokenUsage.cacheReadTokens ?? 0);
  const cacheWrite = Number(tokenUsage.cacheWriteTokens ?? 0);
  return input + output + cache + cacheWrite;
}

function parseUsageBasedCost(raw) {
  if (raw == null || raw === "" || raw === "-" || raw === "—") return null;
  const s = String(raw).trim().replace("$", "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeApiUsageEvent(row) {
  const tsMs = Number(row.timestamp);
  const timestamp = Number.isFinite(tsMs)
    ? new Date(tsMs).toISOString()
    : new Date(String(row.timestamp)).toISOString();

  const tokens = row.isTokenBasedCall ? sumTokensFromUsage(row.tokenUsage) : 0;

  const usageCost = parseUsageBasedCost(row.usageBasedCosts);
  const charged =
    row.chargedCents != null ? Number(row.chargedCents) / 100 : null;
  const type = kindToType(row.kind);
  const costUsd =
    type === "On-Demand" ? (usageCost ?? charged ?? null) : (usageCost ?? null);

  return {
    timestamp,
    user: row.userEmail || row.owningUser || undefined,
    type,
    model: row.model || "unknown",
    tokens,
    costUsd,
    rawCost:
      row.usageBasedCosts ??
      (charged != null ? `$${charged.toFixed(2)}` : undefined),
    kind: row.kind,
  };
}

export function parseApiUsageResponse(rows) {
  return rows.map(normalizeApiUsageEvent);
}

export function formatBillingCycleLabel(billingCycle) {
  if (!billingCycle?.startMs || !billingCycle?.endMs) return null;
  const start = new Date(Number(billingCycle.startMs));
  const end = new Date(Number(billingCycle.endMs));
  const fmt = (d) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} - ${fmt(end)}`;
}
