# Roadmap — the universal research workbench

The goal past v0.1: a system flexible enough that ANY trading idea — an
indicator combo, a seasonality effect, a custom derived dataset — can be
implemented, analyzed and paper-traded using platform primitives alone, with
the statistical gates enforced throughout. If an idea needs custom one-off
plumbing, that's a missing platform feature, not the user's problem.

## Pillars

1. **Indicators as composable primitives** (`src/core/indicators`) — pure
   bar-aligned functions (SMA, EMA, RSI, ATR, rolling stats, z-scores,
   returns) plus combinators (crossovers, streaks). Strategies, feature
   extractors and charts all consume the same library; custom indicators are
   just functions with the same shape.
2. **Datasets** — user-defined derived tables (think: per-weekday seasonal
   profiles, regime labels, liquidity snapshots) with a declared schema,
   built from candles by a registered builder, materialized into Postgres,
   queryable by strategies/research/charts. `midas dataset build <id>`.
3. **Charts** — candles + indicator overlays + dataset series in the mw
   design, on the strategy pages and a standalone /charts explorer. Signals
   plotted on price so every backtest is visually auditable.
4. **Strategy composition** — `StrategyModule` stays the full-power contract;
   the indicator library plus helpers make the typical module ~30 lines.
   Declarative rule definitions (JSON-configurable entries/exits) come after
   the primitives prove out.
5. **From experiment to paper autopilot** — a scheduler runs enabled strategy
   instances (strategy + params + universe + sandbox account) on live data
   and routes signals through the sandbox. "It survived the gates → it
   paper-trades" becomes configuration.

## Phases

- **A — honest evaluation for any signal shape** (issues #10, #11, #6):
  per-signal holding periods in simulation + per-event horizons in the event
  study; analyze cadence in replay; deep historical backfill via Trades/CSV.
- **B — composability**: the indicator library + combinators; reference
  strategy rebuilt on it; "write your strategy in 30 lines" guide.
- **C — datasets**: registry, builders, generic storage, CLI, research
  integration (dataset columns as event-study features).
- **D — visualization**: /charts explorer, signal overlays on strategy pages,
  dataset viewers.
- **E — autopilot** (issue #12): strategy scheduler → sandbox instances, UI
  to enable/disable, uses per-signal horizons for exits.
- **F — hard problems**: honest SHORT/margin modeling (#13), declarative rule
  DSL, trainable strategies with walk-forward refitting.

Sequencing rationale: A unblocks correctness for time-window strategies,
B/C/D make the workbench, E turns it into an operating loop. Statistical
gates (research/README.md) apply at every phase — flexibility never waives
them.
