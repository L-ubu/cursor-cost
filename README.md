<div align="center">

```
 ██████╗██╗   ██╗██████╗ ███████╗ ██████╗ ██████╗      ██████╗ ██████╗ ███████╗████████╗
██╔════╝██║   ██║██╔══██╗██╔════╝██╔═══██╗██╔══██╗    ██╔════╝██╔═══██╗██╔════╝╚══██╔══╝
██║     ██║   ██║██████╔╝███████╗██║   ██║██████╔╝    ██║     ██║   ██║███████╗   ██║
██║     ██║   ██║██╔══██╗╚════██║██║   ██║██╔══██╗    ██║     ██║   ██║╚════██║   ██║
╚██████╗╚██████╔╝██║  ██║███████║╚██████╔╝██║  ██║    ╚██████╗╚██████╔╝███████║   ██║
 ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝
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
```

Then give it your session cookie (30 seconds, once):

1. Open [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage) while logged in
2. DevTools → **Network** → reload → click the `usage` request → copy the full **Cookie** header
3. `mkdir -p ~/.cursor-cost && cd ~/.cursor-cost && cursor-cost` — or paste it into a `.env`:

```bash
echo 'CURSOR_SESSION_COOKIE=<paste here>' > ~/.cursor-cost/.env
```

The cookie jar renews itself from then on — see [How it works](#how-it-works).

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

| Command                          | Answers                                    |
| -------------------------------- | ------------------------------------------ |
| `cursor-cost`                    | How much have I spent this billing cycle?  |
| `cursor-cost models`             | Which model is burning the money?          |
| `cursor-cost day`                | What did each day cost?                    |
| `cursor-cost week`               | Week-over-week trend                       |
| `cursor-cost month`              | Month totals                               |
| `cursor-cost report --json`      | Machine-readable, from the local store     |
| `cursor-cost install-schedule`   | Fetch daily at 08:30 (macOS launchd)       |
| `cursor-cost uninstall-schedule` | Remove the daily job                       |

Set your budget with `CURSOR_MONTHLY_BUDGET_USD` (default `$50`) in
`~/.cursor-cost/.env`.

## How it works

**Your cookie, your machine.** The session cookie seeds a cookie jar at
`~/.cursor-cost/data/session.json`. Every response's `Set-Cookie` is persisted
back, so the WorkOS session rolls forward with use. Run it regularly — the
daily launchd job exists exactly for this — and you won't have to think about
the cookie again.

**Dead session = 30-second fix.** Absolute expiry, logout or a password change
kills the session for good. The tool detects the login redirect, fires a macOS
notification, and prints the re-copy instructions.

**Never double-counts.** Events land in a deduped store keyed on
`(timestamp, model, tokens, cost)`, so overlapping fetches are safe.

**Nothing leaves your machine** except requests to cursor.com itself. Data
lives in `~/.cursor-cost/`, and `.env` / `data/` are gitignored in the repo.

## Caveats

- Only **On-Demand** rows cost real money; "Included" rows are plan usage. The
  report splits them.
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
