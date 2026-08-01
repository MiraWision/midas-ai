# Self-hosting

## Requirements

- Node.js 22+, pnpm 9+
- Docker (for the bundled Postgres) or your own Postgres 15+

## Setup (once)

```bash
git clone https://github.com/MiraWision/midas-ai.git
cd midas-ai
pnpm install
pnpm midas:setup            # .env + Postgres + schema + first market sync + tests
pnpm dev                    # http://localhost:3000
```

`midas:setup` is idempotent — re-run it any time. Running your own Postgres?
Set `DATABASE_URL` in `.env` and use `pnpm midas:setup -- --skip-db`. If port
5432 is taken, set `MIDAS_DB_PORT` (and the port in `DATABASE_URL`) in `.env`.

Setup also installs the **`midas` CLI** — a wrapper at `~/.local/bin/midas`
that runs against this checkout from any directory (`midas help` lists every
command; make sure `~/.local/bin` is on your PATH). The `pnpm` scripts keep
working if you prefer them.

## Updating

```bash
midas update        # or: pnpm midas:update
```

One command: fetches the new version, shows what changed, merges, installs
dependencies, applies additive schema changes, and runs the test suite on
your machine. **Your files survive updates**: `src/strategies/` and the
`research/` workspace are declared user-owned (`.gitattributes` + a merge
driver the updater configures), so on any conflict your version wins.
Committing your local work to your clone before updating is good hygiene but
not required — untracked files are never touched.

Schema changes between versions are additive; your candles, sandbox accounts
and research history are never dropped by an update.

## Market data

Public Kraken endpoints need **no API keys**. Note the venue limit: Kraken's
OHLC endpoint serves only the ~720 most recent candles per interval (≈30 days
of 1h). Deep history must be accumulated by a scheduled sync or built from the
paginated Trades endpoint / Kraken's official CSV dumps.

### Candle sync

```bash
pnpm market:sync -- --refresh-universe   # first run: pick top-30 USDC markets, sync 15m+1h
pnpm market:sync                         # incremental; run this on a schedule
```

Universe refreshes only ever ADD markets — disabling a symbol (set
`enabled = false` in `tracked_markets`) is an operator decision that
automation never reverts. Schedule the sync every 15 minutes (cron example):

```
*/15 * * * * cd /path/to/midas-ai && pnpm market:sync >> /tmp/midas-sync.log 2>&1
```

### Deep backfill (years of history)

The sync only accumulates forward. To build deep history, aggregate candles
from Kraken's public trade tape:

```bash
midas backfill --symbol BTCUSDC --from 2024-01-01
midas backfill --from 2024-06-01          # whole enabled universe
```

Set expectations: ~1000 trades per page at ~1 request/second means a liquid
pair takes **hours** per year of history (illiquid pairs: minutes). Progress
cursors persist in the database after every page, so Ctrl-C and re-running
continues where it stopped. Where backfill overlaps the synced window, the
venue's own OHLC rows win.

## Live trading (opt-in, at your own risk)

MidasAI is sandbox-first and ships with **no live execution enabled**. When
the live contour lands, enabling it will require: explicitly setting
`KRAKEN_TRADING_API_KEY/SECRET` in your local `.env`, keys created **without
withdrawal permission**, and passing pre-flight safety checks. Nothing is
traded on your behalf by default, ever.

This is research software, not financial advice. Assume any strategy you test
is noise until the harness fails to kill it — and even then, size like you
might be wrong.
