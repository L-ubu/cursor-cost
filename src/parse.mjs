import { parse as parseHtml } from "node-html-parser";
import { parseTokenCount, parseCostUsd } from "./util.mjs";

/**
 * @typedef {{
 *   timestamp: string,
 *   user?: string,
 *   type: "Included"|"On-Demand"|string,
 *   model: string,
 *   tokens: number,
 *   costUsd: number | null,
 *   rawCost?: string,
 * }} UsageEvent
 */

export function parseBillingCycle(html) {
  const cycle =
    html.match(
      /Included Usage[\s\S]{0,800}?([A-Z][a-z]{2}\s+\d{1,2}\s*[-–]\s*[A-Z][a-z]{2}\s+\d{1,2},?\s*\d{4})/i,
    )?.[1] ||
    html.match(
      /([A-Z][a-z]{2}\s+\d{1,2})\s*[-–]\s*([A-Z][a-z]{2}\s+\d{1,2},?\s*\d{4})/,
    )?.[0];
  return cycle?.trim() || null;
}

export function parsePagination(html) {
  const m = html.match(/(\d+)\s*[-–]\s*(\d+)\s+of\s+([\d,]+)/i);
  if (!m) return null;
  return {
    from: parseInt(m[1], 10),
    to: parseInt(m[2], 10),
    total: parseInt(m[3].replace(/,/g, ""), 10),
  };
}

function cellText(cell) {
  const title = cell.getAttribute("title");
  if (title) return title.trim();
  return cell.text.trim();
}

function parseRowFromCells(cells) {
  if (cells.length < 6) return null;

  const dateTitle =
    cells[0].getAttribute("title") ||
    cells[0].querySelector("[title]")?.getAttribute("title") ||
    cellText(cells[0]);
  const user = cellText(cells[1]) || undefined;

  let typeVal = cellText(cells[4]);
  let modelVal = cellText(cells[5]);
  let tokensVal = cellText(cells[6]);
  let costVal = cellText(cells[7]);

  if (cells.length >= 8) {
    typeVal = cellText(cells[4]);
    modelVal = cellText(cells[5]);
    tokensVal = cellText(cells[6]);
    costVal = cellText(cells[7]);
  } else if (cells.length === 7) {
    typeVal = cellText(cells[3]);
    modelVal = cellText(cells[4]);
    tokensVal = cellText(cells[5]);
    costVal = cellText(cells[6]);
  }

  const timestamp = normalizeTimestamp(dateTitle);
  if (!timestamp) return null;

  const model = modelVal || "unknown";
  const tokens = parseTokenCount(tokensVal);
  const rawCost = costVal;
  const costUsd = parseCostUsd(costVal);

  if (/^date$/i.test(cellText(cells[0]))) return null;

  return {
    timestamp,
    user,
    type: normalizeType(typeVal),
    model,
    tokens,
    costUsd,
    rawCost,
  };
}

function normalizeType(t) {
  const s = (t || "").trim();
  if (/on[- ]?demand/i.test(s)) return "On-Demand";
  if (/included/i.test(s)) return "Included";
  return s || "Included";
}

function normalizeTimestamp(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const m = s.match(
    /([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?\s*UTC/i,
  );
  if (m) {
    const months = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
    let hour = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = parseInt(m[6], 10);
    const ampm = m[7];
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hour < 12) hour += 12;
      if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;
    }
    const dt = new Date(
      Date.UTC(
        parseInt(m[3], 10),
        months[m[1]],
        parseInt(m[2], 10),
        hour,
        min,
        sec,
      ),
    );
    return dt.toISOString();
  }
  return null;
}

export function parseUsageHtml(html) {
  /** @type {UsageEvent[]} */
  const events = [];
  const root = parseHtml(html, {
    blockTextElements: { script: true, style: true },
  });

  const rows = root.querySelectorAll('[role="row"]');
  for (const row of rows) {
    const cells = row.querySelectorAll('[role="cell"], td, th');
    if (!cells.length) continue;
    const ev = parseRowFromCells(cells);
    if (ev) events.push(ev);
  }

  if (events.length === 0) {
    for (const tr of root.querySelectorAll("table tbody tr")) {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) continue;
      const cells = [...tds].map((td) => ({
        getAttribute: (a) => td.getAttribute(a),
        text: td.text,
        querySelector: (s) => td.querySelector(s),
      }));
      const ev = parseRowFromCells(cells);
      if (ev) events.push(ev);
    }
  }

  return {
    events,
    billingCycle: parseBillingCycle(html),
    pagination: parsePagination(html),
  };
}

export function parseUsageCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2)
    return { events: [], billingCycle: null, pagination: null };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDate = idx(["date"]);
  const iUser = idx(["user"]);
  const iType = idx(["type"]);
  const iKind = idx(["kind"]);
  const iModel = idx(["model"]);
  const iTokens = idx(["total tokens", "token"]);
  const iCost = idx(["cost"]);

  /** @type {UsageEvent[]} */
  const events = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    if (cols.length < 4) continue;
    const timestamp = normalizeTimestamp(cols[iDate >= 0 ? iDate : 0]);
    if (!timestamp) continue;
    const typeCol =
      iKind >= 0 ? cols[iKind] : iType >= 0 ? cols[iType] : "Included";
    const costCol = iCost >= 0 ? cols[iCost] : "";
    events.push({
      timestamp,
      user: iUser >= 0 ? cols[iUser] : undefined,
      type: normalizeType(typeCol),
      model: cols[iModel >= 0 ? iModel : 4] || "unknown",
      tokens: parseTokenCount(cols[iTokens >= 0 ? iTokens : 5]),
      costUsd: parseCostUsd(costCol),
      rawCost: costCol || undefined,
    });
  }
  return { events, billingCycle: null, pagination: null };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function discoverCsvUrls(html) {
  const urls = new Set();
  const patterns = [
    /href="([^"]*export[^"]*csv[^"]*)"/gi,
    /href="([^"]*usage[^"]*\.csv[^"]*)"/gi,
    /"(https?:\/\/[^"]*usage[^"]*csv[^"]*)"/gi,
    /"(https?:\/\/[^"]*export[^"]*)"/gi,
    /\/api\/[^"'\s]*usage[^"'\s]*/gi,
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(html))) {
      const u = m[1] || m[0];
      if (u.startsWith("http") || u.startsWith("/")) urls.add(u);
    }
  }
  return [...urls];
}
