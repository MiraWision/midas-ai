/**
 * seasonal-windows — the weekly-seasonality block.
 *
 * Overlays the last N weeks of 15m log-returns per weekday, weights them by
 * exponential decay, and emits a signal for the NEXT occurrence of every
 * intraday window whose cost-adjusted t-stat beats a circular-shift
 * permutation null (core/analysis/weekly-seasonality). Entry = the window's
 * next start; horizonMs = the window length — so per-event-horizon
 * evaluation and autopilot exits match the idea exactly.
 *
 * Requires 15m candles (the trace grid is quarter-hours).
 */

import { CANDLE_INTERVAL_MS } from '../../exchange/types';
import type { StrategyContext, StrategySignal } from '../../strategy/types';
import {
  analyzeTraces,
  DEFAULT_TRACE_PARAMS,
  mondayStartMs,
  QUARTER_MS,
  WEEK_MS,
  type TraceCandle,
  type TraceEngineParams,
} from '../../analysis/weekly-seasonality';
import type { SignalGenerator } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeasonalWindowsParams extends Record<string, unknown>, TraceEngineParams {}

/**
 * Next occurrence of (dayIndex, startQuarter) at or after nowMs. The engine's
 * day index is MONDAY-BASED (0=Mon..6=Sun) — its position in the weekly trace.
 */
function nextOccurrenceMs(nowMs: number, dayIndex: number, startQuarter: number): number {
  let occurrence = mondayStartMs(nowMs) + dayIndex * DAY_MS + startQuarter * QUARTER_MS;
  while (occurrence < nowMs) occurrence += WEEK_MS;
  return occurrence;
}

export const seasonalWindows: SignalGenerator<SeasonalWindowsParams> = {
  type: 'seasonal-windows',
  defaultParams: { ...DEFAULT_TRACE_PARAMS },

  generate(ctx: StrategyContext, params: SeasonalWindowsParams): StrategySignal[] {
    if (ctx.interval !== '15m') return [];
    const intervalMs = CANDLE_INTERVAL_MS[ctx.interval];
    const signals: StrategySignal[] = [];

    for (const [symbol, candles] of ctx.candles) {
      const closed: TraceCandle[] = [];
      for (const candle of candles) {
        if (candle.openTimeMs + intervalMs <= ctx.nowMs) {
          closed.push({ openTime: new Date(candle.openTimeMs), open: candle.open, close: candle.close });
        }
      }
      if (closed.length < params.minValidWeeks * 672) continue;

      const result = analyzeTraces(closed, ctx.nowMs, params);
      for (const segment of result.segments) {
        signals.push({
          symbol,
          direction: segment.stats.direction,
          entryMs: nextOccurrenceMs(ctx.nowMs, segment.utcWeekday, segment.startQuarter),
          horizonMs: (segment.endQuarter - segment.startQuarter + 1) * QUARTER_MS,
          confidence: segment.confidence,
          meta: {
            tStat: segment.stats.tStat,
            permThreshold: result.permThreshold,
            netEdgePct: segment.stats.netEdgePct,
            dayIndex: segment.utcWeekday,
            startQuarter: segment.startQuarter,
          },
        });
      }
    }
    return signals;
  },
};
