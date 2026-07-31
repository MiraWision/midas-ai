/**
 * Candle sync — accumulate closed candles into the store.
 *
 * Venues like Kraken serve only a short recent window per interval (≈720
 * candles), so history is built by running this sync on a schedule and never
 * deleting. The orchestration is sequential by design: public endpoints are
 * rate-limited, and a self-hosted sync that gets the operator IP-banned is
 * worse than a slow one.
 *
 * Incremental rule: only closed bars are ever stored, so a resume starts
 * strictly after the latest stored open time — no overlap, no revisions.
 */

import type { CandleInterval, MarketDataAdapter } from '../exchange/types';
import { CANDLE_INTERVAL_MS } from '../exchange/types';
import type { CandleRepository, SymbolSyncReport } from './types';

export interface SyncOptions {
  intervals: CandleInterval[];
  /** Injectable clock for tests; defaults to Date.now. */
  nowMs?: number;
}

export async function syncSymbolCandles(
  adapter: MarketDataAdapter,
  repo: CandleRepository,
  symbol: string,
  interval: CandleInterval,
  nowMs: number
): Promise<SymbolSyncReport> {
  const intervalMs = CANDLE_INTERVAL_MS[interval];
  const latest = await repo.latestOpenTimeMs(adapter.id, symbol, interval);
  // Resume strictly after the latest stored bar; undefined → venue default window.
  const sinceMs = latest !== null ? latest + intervalMs : undefined;

  const candles = await adapter.fetchCandles(symbol, interval, sinceMs !== undefined ? { sinceMs } : undefined);
  // Defense in depth: adapters must already drop the forming bar, but a bad
  // adapter here would poison every study downstream.
  const closed = candles.filter((c) => c.openTimeMs + intervalMs <= nowMs);

  const inserted = closed.length > 0 ? await repo.insertCandles(adapter.id, symbol, interval, closed) : 0;
  const newLatest = closed.length > 0 ? closed[closed.length - 1]!.openTimeMs : latest;

  return { symbol, interval, fetched: closed.length, inserted, latestOpenTimeMs: newLatest };
}

/** Sync every symbol × interval sequentially; per-key failures don't abort the run. */
export async function syncCandles(
  adapter: MarketDataAdapter,
  repo: CandleRepository,
  symbols: string[],
  options: SyncOptions
): Promise<SymbolSyncReport[]> {
  const nowMs = options.nowMs ?? Date.now();
  const reports: SymbolSyncReport[] = [];
  for (const symbol of symbols) {
    for (const interval of options.intervals) {
      try {
        reports.push(await syncSymbolCandles(adapter, repo, symbol, interval, nowMs));
      } catch (error) {
        reports.push({
          symbol,
          interval,
          fetched: 0,
          inserted: 0,
          latestOpenTimeMs: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return reports;
}
