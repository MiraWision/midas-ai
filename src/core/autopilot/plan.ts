/**
 * Autopilot tick decisions — pure.
 *
 * A tick takes what the strategy emitted and what the instance already holds,
 * and decides which lots to close and which entries to open. All I/O (candle
 * sync, live tickers, sandbox orders) lives in the runner; this module is the
 * part that must never be wrong, so it is a pure function with tests.
 *
 * Rules:
 * - Only FRESH signals act: entryMs within the current bar. Anything older is
 *   a replayed past signal, not an instruction to trade now.
 * - One open lot per (instance, symbol) — no pyramiding in v1.
 * - SHORT signals are counted and skipped (long-only sandbox); the honest
 *   margin model is issue #13, not a sign flip.
 * - Exit time comes from the signal's horizonMs, else the instance fallback.
 */

import type { StrategySignal } from '../strategy/types';

export interface OpenLot {
  symbol: string;
  quantity: number;
  exitDueMs: number;
}

export interface TickPlan {
  /** Lots whose exit is due — close at market. */
  toClose: OpenLot[];
  /** Fresh LONG signals to enter, with the resolved exit time. */
  toOpen: Array<{ signal: StrategySignal; exitDueMs: number }>;
  skippedShorts: number;
  skippedStale: number;
  skippedAlreadyOpen: number;
}

export function planTick(input: {
  signals: StrategySignal[];
  openLots: OpenLot[];
  nowMs: number;
  intervalMs: number;
  fallbackHoldMs: number;
}): TickPlan {
  const { signals, openLots, nowMs, intervalMs, fallbackHoldMs } = input;

  const toClose = openLots.filter((lot) => lot.exitDueMs <= nowMs);
  const stillOpen = new Set(openLots.filter((lot) => lot.exitDueMs > nowMs).map((lot) => lot.symbol));

  const toOpen: TickPlan['toOpen'] = [];
  let skippedShorts = 0;
  let skippedStale = 0;
  let skippedAlreadyOpen = 0;

  for (const signal of signals) {
    if (signal.direction === 'SHORT') {
      skippedShorts += 1;
      continue;
    }
    // Fresh = actionable in the bar that just closed; tolerate small clock skew forward.
    if (signal.entryMs < nowMs - intervalMs || signal.entryMs > nowMs + intervalMs) {
      skippedStale += 1;
      continue;
    }
    if (stillOpen.has(signal.symbol) || toOpen.some((entry) => entry.signal.symbol === signal.symbol)) {
      skippedAlreadyOpen += 1;
      continue;
    }
    toOpen.push({ signal, exitDueMs: nowMs + (signal.horizonMs ?? fallbackHoldMs) });
  }

  return { toClose, toOpen, skippedShorts, skippedStale, skippedAlreadyOpen };
}
