# Writing a strategy

A strategy is one file in `src/strategies/` implementing `StrategyModule`
(`src/core/strategy/types.ts`) — pure function, closed bars in, signals out.
The reference module [`sma-cross.ts`](../src/strategies/sma-cross.ts) is the
full pattern in ~50 lines.

## The contract, in three rules

1. **No lookahead.** Only use bars with `openTimeMs + intervalMs <= ctx.nowMs`.
   The replay engine slices what you can see anyway — but your live behavior
   must match your backtest behavior, so filter explicitly.
2. **Deterministic.** Same candles + same params → same signals. Randomness
   only via a seed inside `params`.
3. **The exit is part of the signal when you know it.** Set `horizonMs` for
   time-window ideas (session effects, seasonality) — simulation and the
   per-event-horizon edge test will honor it. Omit it for open-ended ideas
   and let the runner's `--hold-bars` apply.

## Compose, don't copy

Build from `src/core/indicators` — SMA/EMA/RSI/ATR/rolling stats/z-scores plus
combinators (`crossedAbove`, `crossedBelow`, `risingFor`). All indicators are
bar-aligned with NaN warmups, so indexes line up across everything. Missing a
primitive? Add it to the library with a test — that's the extension point.

```ts
const price = closes(closed);
const fast = sma(price, params.fastBars);
const slow = sma(price, params.slowBars);
if (crossedAbove(fast, slow, closed.length - 1)) {
  signals.push({ symbol, direction: 'LONG', entryMs: ctx.nowMs });
}
```

## Register and run

```ts
// src/strategies/index.ts
export const STRATEGIES = [smaCross, myStrategy];
```

```bash
midas run --strategy my-strategy --interval 1h        # two-stage gate
midas run --strategy my-strategy --interval 1h --cost-pct 0.24   # cost stress
```

Stage 1 (event study vs random timing) is the verdict; stage 2 (sandbox
simulation) shows path effects. Then pre-register a hypothesis with kill
criteria (`examples/hypotheses/`) before believing anything — the strategy
existing is not evidence.

Your `src/strategies/` files are user-owned: `midas update` never overwrites
them, and nothing outside your clone ever sees them.

## Truly private strategies

`src/strategies/user/` is **gitignored by the platform** — modules there can
never be committed, even by accident. Put anything proprietary in that
directory and register it in `src/strategies/index.ts` (a local, uncommitted
edit that `midas update` preserves). Heavy strategies that re-fit on a
schedule should be evaluated at their operational cadence:

```bash
midas run --strategy my-heavy-strategy --interval 15m --analyze-every 672 --warmup-bars 17472
```
