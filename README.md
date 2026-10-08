<div align="center">

```
 ██████╗██╗   ██╗██████╗ ███████╗ ██████╗ ██████╗        ██████╗ ██████╗ ███████╗████████╗
██╔════╝██║   ██║██╔══██╗██╔════╝██╔═══██╗██╔══██╗      ██╔════╝██╔═══██╗██╔════╝╚══██╔══╝
██║     ██║   ██║██████╔╝███████╗██║   ██║██████╔╝█████╗██║     ██║   ██║███████╗   ██║
██║     ██║   ██║██╔══██╗╚════██║██║   ██║██╔══██╗╚════╝██║     ██║   ██║╚════██║   ██║
╚██████╗╚██████╔╝██║  ██║███████║╚██████╔╝██║  ██║      ╚██████╗╚██████╔╝███████║   ██║
 ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝       ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝
```

**Know what Cursor is costing you. Per model, per day, per month.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-5FA04E.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/cursor-cost.svg)](https://www.npmjs.com/package/cursor-cost)
[![Admin API key needed](https://img.shields.io/badge/admin%20API%20key-not%20needed-brightgreen.svg)](#how-it-works)

[Website](https://l-ubu.github.io/cursor-cost/) · [Install](#install) · [Commands](#commands) · [How it works](#how-it-works)

</div>

---

cursor-cost pulls your usage from
[cursor.com/dashboard/usage](https://cursor.com/dashboard/usage) — the same
endpoints your browser uses — and turns it into a terminal report: cost per
model, per day, week and month, included vs on-demand spend, month-to-date
projection, and a budget bar.

No team admin API key. No config service. One cookie, one command.

## Install

```bash
npm install -g cursor-cost
cursor-cost login
```

`login` opens a browser window on cursor.com — log in there (Google, GitHub,
MFA, whatever you use), and the cookie is captured automatically into
`~/.cursor-cost/`. No DevTools, no copy-pasting.

The cookie jar renews itself from then on — see [How it works](#how-it-works).

<details>
<summary>Manual setup (no browser automation)</summary>

1. Open [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage) while logged in
2. DevTools → **Network** → reload → click the `usage` request → copy the full **Cookie** header
3. Save it:

```bash
echo 'CURSOR_SESSION_COOKIE=<paste here>' > ~/.cursor-cost/.env
```

</details>

## What it looks like

```console
$ cursor-cost

  ╭──────────────────────────────────────────────╮
  │              CURSOR COST REPORT              │
  ╰──────────────────────────────────────────────╯

Billing cycle: Aug 31, 2026 - Sep 30, 2026

Events: 556  │  Tokens: 530.50M

On-Demand: $322.65  │  Included rows: 159

MTD avg/day: $20.17  │  Projected: $604.97 (day 21/30)

Budget $50.00 ████████████████████████████ 100%

  OVER BUDGET — spending is above your monthly cap

╭─ By model ────────────────────────────────────╮
 Model                       │ Tokens  │ On-Demand │ % OD  │ Rows
─────────────────────────────┼─────────┼───────────┼───────┼─────
 claude-opus-5-thinking-high │ 203.86M │ $203.33   │ 63.0% │ 143
 kimi-k3-max                 │ 187.48M │ $111.20   │ 34.5% │ 255
 agent_review                │ 38.34M  │ $6.53     │ 2.0%  │ 18
 composer-2.5-fast           │ 98.98M  │ $0.00     │ 0.0%  │ 136
```

Colors in a real terminal: on-demand spend is red, included is green, the
budget bar shifts green → cyan → yellow → red as you approach the cap.

## Commands

| Command                          | Answers                                   |
| -------------------------------- | ----------------------------------------- |
| `cursor-cost login`              | Capture your session (opens a browser)    |
| `cursor-cost`                    | How much have I spent this billing cycle? |
| `cursor-cost fetch --months N`   | Backfill the last N calendar months       |
| `cursor-cost fetch --all`        | Backfill every month Cursor still has     |
| `cursor-cost models`             | Which model is burning the money?         |
| `cursor-cost day`                | What did each day cost?                   |
| `cursor-cost week`               | Week-over-week trend                      |
| `cursor-cost month`              | Month totals                              |
| `cursor-cost report --json`      | Machine-readable, from the local store    |
| `cursor-cost import <csv>`       | Import a team usage CSV export            |
| `cursor-cost team`               | Per-user team breakdown from imported CSVs |
| `cursor-cost install-schedule`   | Fetch daily at 08:30 (macOS launchd)      |
| `cursor-cost uninstall-schedule` | Remove the daily job                      |

Set your budget with `CURSOR_MONTHLY_BUDGET_USD` (default `$50`) in
`~/.cursor-cost/.env`.

## How it works

**Your cookie, your machine.** `cursor-cost login` drives your installed
browser (Chrome/Edge/Chromium via playwright-core — no bundled download) with a
fresh profile. You log in yourself; the script only reads the resulting
cursor.com cookies and writes them to `~/.cursor-cost/` with `0600`
permissions. Every response's `Set-Cookie` is persisted back, so the WorkOS
session rolls forward with use. Run it regularly — the daily launchd job
exists exactly for this — and you won't have to think about the cookie again.

**Dead session = one command.** Absolute expiry, logout or a password change
kills the session for good. The tool detects the login redirect, fires a macOS
notification, and `cursor-cost login` gets you back in under a minute.

**Never double-counts.** Events land in a deduped store keyed on
`(timestamp, model, tokens, cost)`, so overlapping fetches are safe.
After install, run `cursor-cost fetch --all` once if you want prior months in
`cursor-cost month`; depth depends on what Cursor still exposes in the dashboard.

**Nothing leaves your machine** except requests to cursor.com itself. Data
lives in `~/.cursor-cost/`, and `.env` / `data/` are gitignored in the repo.

## Caveats

- The main report totals (on-demand spend, budget bar, by model) are scoped to
  the **current billing cycle** from the dashboard API. `day`, `week`, and
  `month` breakdowns use everything in your local store.
- Only **On-Demand** rows cost real money; "Included" rows are plan usage. The
  report splits them. Dollar amounts come from the dashboard field
  `usageBasedCosts` (same as the Cost column in the usage UI), not the CSV
  **Requests** column.
- The dashboard API only exposes **your own** events, so fetch and the report
  are always personal. For team totals, export the team usage CSV from the
  dashboard (it has a real Cost column) and run `cursor-cost import <csv>`,
  then `cursor-cost team`. Team data lives in a separate store and never mixes
  into your personal report.
- If Cursor changes the dashboard endpoints, the fetcher needs a small update.
  There are three fallbacks (JSON API → CSV export → HTML scrape), in that
  order.
- Treat your session cookie like a password. Don't commit it, don't paste it
  in chats.

## Development

```bash
git clone https://github.com/L-ubu/cursor-cost
cd cursor-cost
npm install
npm run verify   # parser smoke test against a dashboard fixture
npm run cost
```

## License

MIT © [L-ubu](https://github.com/L-ubu)
