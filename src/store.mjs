import { config } from "../config.mjs";
import { readJson, writeJson, ensureDir } from "./util.mjs";

function eventKey(ev) {
  return [ev.timestamp, ev.user || "", ev.model, ev.tokens, ev.costUsd ?? "", ev.type].join("|");
}

export function loadEvents(filePath = config.eventsPath) {
  const data = readJson(filePath, {
    version: 1,
    events: [],
    meta: {},
  });
  if (!data.events) data.events = [];
  return data;
}

export function loadTeamEvents() {
  return loadEvents(config.teamEventsPath);
}

export function mergeEvents(existing, incoming, metaPatch = {}, outPath = config.eventsPath) {
  const seen = new Set(existing.events.map(eventKey));
  let added = 0;
  for (const ev of incoming) {
    const key = eventKey(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    existing.events.push(ev);
    added++;
  }
  existing.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  existing.meta = { ...existing.meta, ...metaPatch, lastFetchAt: new Date().toISOString() };
  ensureDir(config.dataDir);
  writeJson(outPath, existing);
  return { added, total: existing.events.length };
}
