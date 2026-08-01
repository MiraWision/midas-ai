/**
 * Trade → candle aggregation for deep backfills.
 *
 * Venue OHLC endpoints cap their lookback (Kraken: ~720 candles), but raw
 * trade history goes back years. This module turns an ASCENDING stream of
 * trades into closed OHLCV candles, streaming-safe: buckets are only drained
 * once the stream has provably moved past them, so a paginated multi-hour
 * backfill can flush to the database as it goes.
 *
 * Empty buckets are simply absent — downstream consumers already treat
 * missing bars as gaps (the harness gap-rejects lookups across them).
 */

import type { Candle } from '../exchange/types';

export interface Trade {
  timeMs: number;
  price: number;
  volume: number;
}

export class TradeCandleAggregator {
  private buckets = new Map<number, Candle>();
  private maxTradeTimeMs = 0;

  constructor(private readonly intervalMs: number) {
    if (!(intervalMs > 0)) throw new Error('intervalMs must be positive');
  }

  add(trade: Trade): void {
    if (!(trade.price > 0) || !(trade.volume >= 0)) return;
    this.maxTradeTimeMs = Math.max(this.maxTradeTimeMs, trade.timeMs);
    const openTimeMs = Math.floor(trade.timeMs / this.intervalMs) * this.intervalMs;
    const bucket = this.buckets.get(openTimeMs);
    if (!bucket) {
      this.buckets.set(openTimeMs, {
        openTimeMs,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.volume,
      });
      return;
    }
    bucket.high = Math.max(bucket.high, trade.price);
    bucket.low = Math.min(bucket.low, trade.price);
    bucket.close = trade.price; // trades arrive ascending
    bucket.volume += trade.volume;
  }

  /**
   * Candles whose interval has provably ended: trades arrive ascending, so a
   * bucket is closed once the stream has reached its close time. Call after
   * each page; returned candles are removed.
   */
  drainClosed(): Candle[] {
    return this.drainBefore(this.maxTradeTimeMs);
  }

  /** Drain everything closing at or before `boundaryMs` (end of stream). */
  drainBefore(boundaryMs: number): Candle[] {
    const closed: Candle[] = [];
    for (const [openTimeMs, candle] of this.buckets) {
      if (openTimeMs + this.intervalMs <= boundaryMs) {
        closed.push(candle);
        this.buckets.delete(openTimeMs);
      }
    }
    return closed.sort((a, b) => a.openTimeMs - b.openTimeMs);
  }

  get pendingBuckets(): number {
    return this.buckets.size;
  }
}
