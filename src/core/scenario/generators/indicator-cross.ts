/**
 * indicator-cross — the moving-average/oscillator crossover block.
 *
 * Emits LONG when `fast` crosses above `slow`, SHORT when it crosses below,
 * using the indicator library. Both lines are declared, not coded:
 *
 *   { "fast": { "fn": "sma", "window": 12 }, "slow": { "fn": "ema", "window": 48 } }
 */

import { CANDLE_INTERVAL_MS } from '../../exchange/types';
import { closes, crossedAbove, crossedBelow, ema, sma } from '../../indicators';
import type { StrategyContext, StrategySignal } from '../../strategy/types';
import type { SignalGenerator } from '../types';

export interface IndicatorLine extends Record<string, unknown> {
  fn: 'sma' | 'ema';
  window: number;
}

export interface IndicatorCrossParams extends Record<string, unknown> {
  fast: IndicatorLine;
  slow: IndicatorLine;
  /** Emit SHORT on downward crosses (default true; set false for long-only). */
  emitShorts?: boolean;
}

const INDICATOR_FNS = {
  sma,
  ema,
} as const;

function computeLine(values: number[], line: IndicatorLine): number[] {
  const fn = INDICATOR_FNS[line.fn];
  if (!fn) throw new Error(`indicator-cross: unknown fn "${String(line.fn)}" (have: ${Object.keys(INDICATOR_FNS).join(', ')})`);
  if (!(line.window >= 1)) throw new Error('indicator-cross: window must be >= 1');
  return fn(values, line.window);
}

export const indicatorCross: SignalGenerator<IndicatorCrossParams> = {
  type: 'indicator-cross',
  defaultParams: { fast: { fn: 'sma', window: 12 }, slow: { fn: 'sma', window: 48 }, emitShorts: true },

  generate(ctx: StrategyContext, params: IndicatorCrossParams): StrategySignal[] {
    const intervalMs = CANDLE_INTERVAL_MS[ctx.interval];
    const signals: StrategySignal[] = [];
    const warmup = Math.max(params.fast.window, params.slow.window) + 1;

    for (const [symbol, candles] of ctx.candles) {
      const closed = candles.filter((c) => c.openTimeMs + intervalMs <= ctx.nowMs);
      if (closed.length < warmup) continue;
      const price = closes(closed);
      const fast = computeLine(price, params.fast);
      const slow = computeLine(price, params.slow);
      const last = closed.length - 1;

      const up = crossedAbove(fast, slow, last);
      const down = crossedBelow(fast, slow, last);
      if (up || (down && params.emitShorts !== false)) {
        signals.push({
          symbol,
          direction: up ? 'LONG' : 'SHORT',
          entryMs: ctx.nowMs,
          meta: { fast: fast[last]!, slow: slow[last]! },
        });
      }
    }
    return signals;
  },
};
