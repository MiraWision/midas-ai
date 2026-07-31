# Worked example: pre-registering the SMA-cross hypothesis

This is what a hypothesis looks like BEFORE any code runs. Copy the shape, not
the idea.

## Hypothesis

On liquid USDC spot pairs at 1h resolution, an SMA(12/48) crossover in the
direction of the cross carries positive forward return net of 0.12% round-trip
costs over the following 24h.

## Kill criteria (fixed before the experiment)

1. **Direction:** mean net 24h return of cross-direction entries is not
   significantly better than random-timing entries with the same direction mix
   (permutation p ≥ 0.05), on both IS and OOS halves — or the sign flips
   between halves.
2. **Cost fragility:** any nominally positive edge at 0.12% costs disappears
   at 0.24% (taker/slippage stress) — an edge that thin is untradeable.

Either criterion firing → the hypothesis dies and the result is recorded in
`research/knowledge/` as a negative finding.

## Degrees of freedom declared

- SMA windows: 12/48 only (no scanning); scanning would multiply comparisons
  and must be declared in the ledger if ever done.
- Horizons examined: 4h, 24h (2 comparisons).
- Cost levels: 0.06 / 0.12 / 0.24 (sensitivity, not selection).

## How to run it

Extract crossover events with the strategy module, hand them to the harness:

```ts
import { runEventStudy, buildPriceSeries } from '../../src/core/research/event-study';
// events: { timestampMs, symbol, direction, features } per crossover
// series: buildPriceSeries(symbol, candles) per symbol
const report = runEventStudy(seriesBySymbol, events, { costPct: 0.12, permSeed: 1 });
```

Expected outcome, honestly: this dies at gate 1. That is the platform working.
