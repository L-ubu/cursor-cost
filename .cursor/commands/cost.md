---
description: Fetch latest Cursor usage and show cost report (models, day/week/month, budget)
---

Run the cursor-cost tooling for this workspace and show the user the terminal output.

1. From the workspace root `/Users/luca.vandenweghe/cursor-cost`, run:
   - Default: `npm run cost` (fetch + full report with model breakdown)
   - If the user said `/cost week`: `npm run fetch && node src/report.mjs week`
   - If `/cost month`: `npm run fetch && node src/report.mjs month`
   - If `/cost models`: `npm run fetch && node src/report.mjs models`
   - If `/cost day`: `npm run fetch && node src/report.mjs day`
   - If auth fails, tell them to refresh `CURSOR_SESSION_COOKIE` in `.env` and retry.

2. Paste the command output in chat. Summarize on-demand spend vs budget and top 3 models by cost.

3. Do not print or commit session cookies or contents of `data/session.json`.
