/**
 * Stage-2 evaluation: fold a signal stream through the sandbox engine.
 *
 * Honesty rules:
 * - Entries fill at the OPEN of the first bar at/after the signal's entryMs
 *   (never the signal bar's close — that price was not obtainable).
 * - Exits fill at the open of the first bar at/after entry + holdBars.
 * - Fills inherit the sandbox's pessimism (slippage + taker fee both ways).
 * - Long-only: SHORT signals are counted but not simulated (spot sandbox).
 *
 * This is NOT a statistical test — run the stage-1 event study first. The
 * simulation exists to expose path effects (capital contention, drawdown)
 * that per-event statistics cannot show.
 */

import type { Candle, CandleInterval } from '../exchange/types';
import { CANDLE_INTERVAL_MS } from '../exchange/types';
import {
  createSandboxState,
  executeOrder,
  markToMarket,
  type SandboxConfig,
  type SandboxState,
  type SandboxTrade,
} from '../sandbox/engine';
import type { StrategySignal } from './types';

export interface SimulationOptions {
  interval: CandleInterval;
  /** Bars to hold each position before exiting. */
  holdBars: number;
  /** Quote spent per entry. */
  quotePerTrade: number;
  sandbox: SandboxConfig;
}

export interface SimulationResult {
  trades: SandboxTrade[];
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  simulatedSignals: number;
  skippedShorts: number;
  /** Entries skipped because cash was already committed. */
  skippedNoCash: number;
  equityCurve: Array<{ timestampMs: number; equity: number }>;
}

interface OpenLot {
  symbol: string;
  quantity: number;
  exitDueMs: number;
}

function openAtOrAfter(candles: readonly Candle[], targetMs: number, intervalMs: number): Candle | null {
  for (const candle of candles) {
    if (candle.openTimeMs >= targetMs) {
      return candle.openTimeMs - targetMs > intervalMs * 1.5 ? null : candle;
    }
  }
  return null;
}

export function simulateSignals(
  signals: StrategySignal[],
  candlesBySymbol: ReadonlyMap<string, readonly Candle[]>,
  options: SimulationOptions
): SimulationResult {
  const intervalMs = CANDLE_INTERVAL_MS[options.interval];
  let state: SandboxState = createSandboxState(options.sandbox);
  const trades: SandboxTrade[] = [];
  const lots: OpenLot[] = [];
  const equityCurve: Array<{ timestampMs: number; equity: number }> = [];
  let skippedShorts = 0;
  let skippedNoCash = 0;

  const events: Array<{ timestampMs: number; kind: 'ENTRY' | 'EXIT'; signal?: StrategySignal; lot?: OpenLot }> = [];
  for (const signal of signals) {
    if (signal.direction === 'SHORT') {
      skippedShorts += 1;
      continue;
    }
    events.push({ timestampMs: signal.entryMs, kind: 'ENTRY', signal });
  }

  // Process chronologically; exits are injected as lots open.
  events.sort((a, b) => a.timestampMs - b.timestampMs);
  const queue = events;

  while (queue.length > 0) {
    const event = queue.shift()!;
    const symbol = event.kind === 'ENTRY' ? event.signal!.symbol : event.lot!.symbol;
    const candles = candlesBySymbol.get(symbol);
    if (!candles) continue;
    const fillBar = openAtOrAfter(candles, event.timestampMs, intervalMs);
    if (!fillBar) continue;

    if (event.kind === 'ENTRY') {
      const quantity = options.quotePerTrade / fillBar.open;
      try {
        const result = executeOrder(state, options.sandbox, {
          timestampMs: fillBar.openTimeMs,
          symbol,
          side: 'BUY',
          quantity,
          price: fillBar.open,
        });
        state = result.state;
        trades.push(result.trade);
        const lot: OpenLot = { symbol, quantity, exitDueMs: fillBar.openTimeMs + options.holdBars * intervalMs };
        queue.push({ timestampMs: lot.exitDueMs, kind: 'EXIT', lot });
        queue.sort((a, b) => a.timestampMs - b.timestampMs);
        lots.push(lot);
      } catch {
        skippedNoCash += 1;
      }
    } else {
      const lot = event.lot!;
      try {
        const result = executeOrder(state, options.sandbox, {
          timestampMs: fillBar.openTimeMs,
          symbol,
          side: 'SELL',
          quantity: lot.quantity,
          price: fillBar.open,
        });
        state = result.state;
        trades.push(result.trade);
      } catch {
        // lot unsellable only if state drifted — surface via final equity
      }
    }

    const snapshot = markToMarket(state, latestPrices(candlesBySymbol, event.timestampMs, intervalMs));
    equityCurve.push({ timestampMs: event.timestampMs, equity: snapshot.equity });
  }

  const lastPrices = latestPrices(candlesBySymbol, Number.POSITIVE_INFINITY, intervalMs);
  const finalEquity = markToMarket(state, lastPrices).equity;

  let peak = options.sandbox.startingCash;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  return {
    trades,
    finalEquity,
    totalReturnPct: ((finalEquity - options.sandbox.startingCash) / options.sandbox.startingCash) * 100,
    maxDrawdownPct,
    simulatedSignals: signals.length - skippedShorts,
    skippedShorts,
    skippedNoCash,
    equityCurve,
  };
}

function latestPrices(
  candlesBySymbol: ReadonlyMap<string, readonly Candle[]>,
  atMs: number,
  intervalMs: number
): Map<string, number> {
  const prices = new Map<string, number>();
  for (const [symbol, candles] of candlesBySymbol) {
    let last: Candle | null = null;
    for (const candle of candles) {
      if (candle.openTimeMs + intervalMs <= atMs) last = candle;
      else break;
    }
    if (last) prices.set(symbol, last.close);
  }
  return prices;
}
