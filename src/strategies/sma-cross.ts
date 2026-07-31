/**
 * SMA crossover — a REFERENCE strategy, not a recommendation.
 *
 * It exists to show the `StrategyModule` contract end-to-end: pure analysis
 * over closed bars, no lookahead, deterministic output. Moving-average
 * crossovers are one of the most-tested ideas in finance and generally do NOT
 * survive transaction costs — which makes this a perfect first hypothesis to
 * kill with the platform's own harness. See examples/hypotheses/ for the
 * worked pre-registration.
 */

import type { StrategyContext, StrategyModule, StrategySignal } from '@/core/strategy/types';
import { CANDLE_INTERVAL_MS } from '@/core/exchange/types';

export interface SmaCrossParams extends Record<string, unknown> {
  fastBars: number;
  slowBars: number;
}

function smaAt(closes: number[], endExclusive: number, window: number): number | null {
  if (endExclusive < window) return null;
  let sum = 0;
  for (let i = endExclusive - window; i < endExclusive; i += 1) sum += closes[i]!;
  return sum / window;
}

export const smaCross: StrategyModule<SmaCrossParams> = {
  id: 'sma-cross',
  name: 'SMA crossover (reference example)',
  defaultParams: { fastBars: 12, slowBars: 48 },

  analyze(ctx: StrategyContext, params: SmaCrossParams): StrategySignal[] {
    const intervalMs = CANDLE_INTERVAL_MS[ctx.interval];
    const signals: StrategySignal[] = [];

    for (const [symbol, candles] of ctx.candles) {
      // Respect the lookahead rule: only fully closed bars.
      const closed = candles.filter((c) => c.openTimeMs + intervalMs <= ctx.nowMs);
      const n = closed.length;
      if (n < params.slowBars + 1) continue;
      const closes = closed.map((c) => c.close);

      const fastNow = smaAt(closes, n, params.fastBars);
      const slowNow = smaAt(closes, n, params.slowBars);
      const fastPrev = smaAt(closes, n - 1, params.fastBars);
      const slowPrev = smaAt(closes, n - 1, params.slowBars);
      if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) continue;

      const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
      const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;
      if (!crossedUp && !crossedDown) continue;

      signals.push({
        symbol,
        direction: crossedUp ? 'LONG' : 'SHORT',
        entryMs: ctx.nowMs,
        meta: { fast: fastNow, slow: slowNow },
      });
    }

    return signals;
  },
};
