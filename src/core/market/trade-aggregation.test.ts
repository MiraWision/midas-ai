import { describe, expect, it } from 'vitest';

import { TradeCandleAggregator, type Trade } from './trade-aggregation';

const M = 60_000;

function trade(timeMs: number, price: number, volume = 1): Trade {
  return { timeMs, price, volume };
}

describe('TradeCandleAggregator', () => {
  it('builds OHLCV correctly within a bucket', () => {
    const agg = new TradeCandleAggregator(15 * M);
    agg.add(trade(0, 100, 2));
    agg.add(trade(5 * M, 105, 1));
    agg.add(trade(9 * M, 95, 3));
    agg.add(trade(14 * M, 101, 1));
    const [candle] = agg.drainBefore(15 * M);
    expect(candle).toEqual({ openTimeMs: 0, open: 100, high: 105, low: 95, close: 101, volume: 7 });
  });

  it('drainClosed only releases buckets the stream has moved past', () => {
    const agg = new TradeCandleAggregator(15 * M);
    agg.add(trade(1 * M, 100));
    agg.add(trade(16 * M, 110)); // second bucket opens, first not yet provably closed? stream at 16m > 15m end
    expect(agg.drainClosed().map((c) => c.openTimeMs)).toEqual([0]);
    expect(agg.pendingBuckets).toBe(1);
    agg.add(trade(31 * M, 120));
    expect(agg.drainClosed().map((c) => c.openTimeMs)).toEqual([15 * M]);
  });

  it('leaves gaps absent instead of inventing empty candles', () => {
    const agg = new TradeCandleAggregator(15 * M);
    agg.add(trade(1 * M, 100));
    agg.add(trade(61 * M, 100)); // 45m of silence in between
    const closed = agg.drainBefore(120 * M);
    expect(closed.map((c) => c.openTimeMs)).toEqual([0, 60 * M]);
  });

  it('ignores non-positive prices and keeps determinism across drains', () => {
    const agg = new TradeCandleAggregator(15 * M);
    agg.add(trade(0, -5));
    agg.add(trade(1 * M, 100));
    expect(agg.drainBefore(15 * M)).toHaveLength(1);
    expect(agg.drainBefore(15 * M)).toHaveLength(0); // already drained
  });
});
