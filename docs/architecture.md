# Architecture

MidasAI is a self-hosted Next.js application with a Postgres store and a set
of pure, testable core modules. The dependency direction is strict: the app
depends on core; core depends on nothing above it.

```
src/
├── app/          # Next.js UI (dashboard, research, sandbox, agent)
├── components/   # design-system shell + UI kit
├── core/
│   ├── exchange/ # MarketDataAdapter + TradingAdapter contracts, kraken/
│   ├── strategy/ # StrategyModule contract (pure, lookahead-free analyze())
│   ├── research/ # event-study harness — the statistical core (tested)
│   └── agent/    # AgentRunner contract for agent-on-rails research
└── db/           # drizzle schema (market_candles) + client
research/         # the methodology workspace (see research/README.md)
examples/         # reference strategy + worked hypothesis pre-registration
```

## Design principles

1. **The statistics are the platform.** Everything else — UI, connectors,
   agents — exists to feed honest inputs into `core/research` and to act on
   its outputs. Weakening a null is a breaking change.
2. **Pure cores, thin edges.** `strategy` and `research` modules are pure and
   deterministic (seeded PRNG, no clock reads, no I/O). Adapters at the edges
   do I/O and nothing else. This is what makes experiments reproducible.
3. **Lookahead safety by contract.** Strategies only see closed bars
   (`openTimeMs + intervalMs <= nowMs`); the Kraken adapter drops the
   still-forming candle; the harness rejects gap-crossing measurements.
4. **Sandbox-first.** Market data and paper trading need no keys. Live
   execution is a separate, opt-in adapter surface that must work with
   no-withdrawal API keys.
5. **Agents are constrained by the harness, not by trust.** An agent gets
   write access to `research/**` only, an allow-listed toolchain, a spend
   budget, and a methodology that requires every number to come from
   re-runnable script output.

## Data model

One table to start: `market_candles (source, symbol, interval, open_time_ms,
o/h/l/c/v)` with a unique index on the natural key. Venue namespacing via
`source` keeps multi-exchange data from colliding. Sandbox/live state tables
land with their engines.

## Roadmap (tracked as issues)

1. Candle sync service + universe management (Kraken USDC spot first).
2. Sandbox engine: paper trading against the live feed.
3. Walk-forward runner for `StrategyModule` with per-fold retraining.
4. Agent runner (Claude Code adapter) + `research:iterate` CLI.
5. Research UI: queue, ledger, findings browser, report viewer.
