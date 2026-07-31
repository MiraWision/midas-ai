/**
 * Market-data persistence contracts.
 *
 * Sync orchestration (candle-sync.ts, universe.ts) is written against these
 * interfaces, not against drizzle — so the logic is unit-testable with
 * in-memory fakes and the storage layer stays swappable. The drizzle
 * implementations live in src/db/repositories/market.ts.
 */

import type { Candle, CandleInterval } from '../exchange/types';

export interface CandleRepository {
  /** Latest stored open time for the key, or null when nothing is stored. */
  latestOpenTimeMs(source: string, symbol: string, interval: CandleInterval): Promise<number | null>;
  /**
   * Insert candles, ignoring rows whose (source, symbol, interval, openTimeMs)
   * already exist. Returns the number of newly inserted rows.
   */
  insertCandles(source: string, symbol: string, interval: CandleInterval, candles: Candle[]): Promise<number>;
}

export interface UniverseRepository {
  /** Enabled tracked symbols for a source, alphabetical. */
  listEnabled(source: string): Promise<string[]>;
  /**
   * Ensure the given symbols exist as tracked (enabled). Symbols already
   * present keep their enabled/disabled state — a refresh never re-enables
   * something the operator turned off.
   */
  addMissing(source: string, symbols: string[]): Promise<number>;
}

export interface SymbolSyncReport {
  symbol: string;
  interval: CandleInterval;
  fetched: number;
  inserted: number;
  /** Latest stored open time after the sync, null if still empty. */
  latestOpenTimeMs: number | null;
  error?: string;
}
