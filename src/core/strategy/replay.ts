/**
 * Signal replay — walk a strategy through history with no lookahead.
 *
 * At every closed bar the strategy sees ONLY the candles up to that bar
 * (enforced here by slicing, not trusted to the strategy), exactly as it
 * would live. The output is the strategy's signal stream, ready for the
 * two-stage evaluation:
 *   stage 1 — event study vs a random-timing null (core/research),
 *   stage 2 — sandbox simulation with pessimistic fills (core/sandbox).
 */

import type { Candle, CandleInterval } from '../exchange/types';
import { CANDLE_INTERVAL_MS } from '../exchange/types';
import type { StrategyModule, StrategySignal } from './types';

export interface ReplayOptions {
  interval: CandleInterval;
  /** Bars to skip before the first analyze call (indicator warmup). */
  warmupBars: number;
}

export interface ReplayResult {
  signals: StrategySignal[];
  /** Number of analyze() steps executed. */
  steps: number;
}

/**
 * Replays over the UNION of bar timestamps across symbols. Signals are
 * deduplicated on (symbol, direction, entryMs) — a strategy re-emitting the
 * same signal on consecutive bars counts once at its first appearance.
 */
export function replaySignals<P extends Record<string, unknown>>(
  strategy: StrategyModule<P>,
  params: P,
  candlesBySymbol: ReadonlyMap<string, readonly Candle[]>,
  options: ReplayOptions
): ReplayResult {
  const intervalMs = CANDLE_INTERVAL_MS[options.interval];

  const allTimes = new Set<number>();
  for (const candles of candlesBySymbol.values()) {
    for (const candle of candles) allTimes.add(candle.openTimeMs);
  }
  const times = [...allTimes].sort((a, b) => a - b);

  // Per-symbol cursor: how many bars are closed at the current step.
  const cursors = new Map<string, number>();
  for (const symbol of candlesBySymbol.keys()) cursors.set(symbol, 0);

  const seen = new Set<string>();
  const signals: StrategySignal[] = [];
  let steps = 0;

  for (let t = options.warmupBars; t < times.length; t += 1) {
    const nowMs = times[t]! + intervalMs; // the bar at times[t] has just closed
    const visible = new Map<string, readonly Candle[]>();
    for (const [symbol, candles] of candlesBySymbol) {
      let cursor = cursors.get(symbol)!;
      while (cursor < candles.length && candles[cursor]!.openTimeMs + intervalMs <= nowMs) cursor += 1;
      cursors.set(symbol, cursor);
      if (cursor > 0) visible.set(symbol, candles.slice(0, cursor));
    }

    const emitted = strategy.analyze({ candles: visible, interval: options.interval, nowMs }, params);
    steps += 1;

    for (const signal of emitted) {
      if (signal.entryMs < nowMs) continue; // lookahead-stamped signals are discarded
      const key = `${signal.symbol}|${signal.direction}|${signal.entryMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      signals.push(signal);
    }
  }

  signals.sort((a, b) => a.entryMs - b.entryMs);
  return { signals, steps };
}
