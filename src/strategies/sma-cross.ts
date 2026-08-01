/**
 * SMA crossover — a REFERENCE strategy, not a recommendation.
 *
 * It exists to show the `StrategyModule` contract composed from the indicator
 * library: pure analysis over closed bars, no lookahead, deterministic
 * output. Moving-average crossovers are one of the most-tested ideas in
 * finance and generally do NOT survive transaction costs — which makes this a
 * perfect first hypothesis to kill with the platform's own harness. See
 * examples/hypotheses/ for the worked pre-registration.
 */

import { CANDLE_INTERVAL_MS } from '@/core/exchange/types';
import { closes, crossedAbove, crossedBelow, sma } from '@/core/indicators';
import type { StrategyContext, StrategyModule, StrategySignal } from '@/core/strategy/types';

export interface SmaCrossParams extends Record<string, unknown> {
  fastBars: number;
  slowBars: number;
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
      if (closed.length < params.slowBars + 1) continue;

      const price = closes(closed);
      const fast = sma(price, params.fastBars);
      const slow = sma(price, params.slowBars);
      const last = closed.length - 1;

      const up = crossedAbove(fast, slow, last);
      const down = crossedBelow(fast, slow, last);
      if (!up && !down) continue;

      signals.push({
        symbol,
        direction: up ? 'LONG' : 'SHORT',
        entryMs: ctx.nowMs,
        meta: { fast: fast[last]!, slow: slow[last]! },
      });
    }

    return signals;
  },
};
