# Self-hosting

## Requirements

- Node.js 22+, pnpm 9+
- Docker (for the bundled Postgres) or your own Postgres 15+

## Setup

```bash
git clone https://github.com/MiraWision/midas-ai.git
cd midas-ai
cp .env.example .env        # defaults work with the bundled Postgres
docker compose up -d db
pnpm install
pnpm db:push                # create tables
pnpm dev                    # http://localhost:3000
```

Verify the statistical core on your machine any time with `pnpm test`.

## Market data

Public Kraken endpoints need **no API keys**. Note the venue limit: Kraken's
OHLC endpoint serves only the ~720 most recent candles per interval (≈30 days
of 1h). Deep history must be accumulated by a scheduled sync or built from the
paginated Trades endpoint / Kraken's official CSV dumps.

## Live trading (opt-in, at your own risk)

MidasAI is sandbox-first and ships with **no live execution enabled**. When
the live contour lands, enabling it will require: explicitly setting
`KRAKEN_TRADING_API_KEY/SECRET` in your local `.env`, keys created **without
withdrawal permission**, and passing pre-flight safety checks. Nothing is
traded on your behalf by default, ever.

This is research software, not financial advice. Assume any strategy you test
is noise until the harness fails to kill it — and even then, size like you
might be wrong.
