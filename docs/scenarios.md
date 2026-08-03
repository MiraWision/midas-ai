# No-code scenarios

A scenario is a strategy assembled from platform blocks — one JSON file, zero
code. It compiles into the same `StrategyModule` contract as code strategies,
so replay, the two-stage gates, autopilot and the UI treat it identically.

```json
{
  "id": "my-seasonality",
  "name": "My weekly seasonality scan",
  "interval": "15m",
  "signal": {
    "type": "seasonal-windows",
    "params": { "weeksBack": 26, "lambdaDecay": 0.05, "permQuantile": 0.95 }
  }
}
```

Drop it in `src/scenarios/`, add one import line in `src/scenarios/index.ts`,
and run it like anything else:

```bash
midas run --strategy my-seasonality --interval 15m --analyze-every 672 --warmup-bars 17472
midas autopilot add --strategy my-seasonality --account <id> --interval 15m
```

Private scenarios go in `src/scenarios/user/` — gitignored by the platform,
impossible to commit.

## Available signal generators (the blocks)

- **`seasonal-windows`** — weekly seasonality: overlays N weeks of 15m
  returns per weekday with exponential decay, keeps intraday windows whose
  cost-adjusted t-stat beats a circular-shift permutation null
  (`src/core/analysis/weekly-seasonality.ts`). Signals carry the window as
  `horizonMs`, so per-event-horizon evaluation and autopilot exits match the
  idea. Params: `weeksBack`, `lambdaDecay`, `costPct`, `permQuantile`,
  `permIterations`, `minValidWeeks`, segment size/gap bounds.
- **`indicator-cross`** — declarative crossovers over the indicator library:
  `{"fast": {"fn": "sma", "window": 12}, "slow": {"fn": "ema", "window": 48}}`,
  optional `emitShorts: false`.

## The rule of the platform

If your idea needs mechanics no generator covers, the answer is a **new
generator** in `src/core/scenario/generators/` — a reusable, tested block —
never a one-off strategy module. That's how the lego box grows: PRs adding
generators are the most valuable kind (see CONTRIBUTING).
