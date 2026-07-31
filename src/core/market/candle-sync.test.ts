import { describe, expect, it } from 'vitest';

import type { Candle, CandleInterval, FetchCandlesOptions, MarketDataAdapter, MarketRef, Ticker } from '../exchange/types';
import { CANDLE_INTERVAL_MS } from '../exchange/types';
import type { CandleRepository } from './types';
import { syncCandles, syncSymbolCandles } from './candle-sync';
import { selectUniverse } from './universe';

const H = CANDLE_INTERVAL_MS['1h'];
const T0 = Date.UTC(2026, 0, 1);

function candle(openTimeMs: number, price = 100): Candle {
  return { openTimeMs, open: price, high: price, low: price, close: price, volume: 1 };
}

class FakeAdapter implements MarketDataAdapter {
  readonly id = 'fake';
  calls: Array<{ symbol: string; opts?: FetchCandlesOptions }> = [];
  constructor(private candlesBySymbol: Record<string, Candle[]>) {}

  async listMarkets(): Promise<MarketRef[]> {
    return [];
  }
  async fetchTicker(): Promise<Ticker> {
    throw new Error('not used');
  }
  async fetchCandles(symbol: string, _interval: CandleInterval, opts?: FetchCandlesOptions): Promise<Candle[]> {
    this.calls.push({ symbol, opts });
    const all = this.candlesBySymbol[symbol] ?? [];
    if (symbol === 'BOOM') throw new Error('venue exploded');
    return opts?.sinceMs !== undefined ? all.filter((c) => c.openTimeMs >= opts.sinceMs!) : all;
  }
}

class FakeRepo implements CandleRepository {
  stored = new Map<string, Candle[]>();
  private key(source: string, symbol: string, interval: string): string {
    return `${source}:${symbol}:${interval}`;
  }
  async latestOpenTimeMs(source: string, symbol: string, interval: CandleInterval): Promise<number | null> {
    const rows = this.stored.get(this.key(source, symbol, interval)) ?? [];
    return rows.length > 0 ? rows[rows.length - 1]!.openTimeMs : null;
  }
  async insertCandles(source: string, symbol: string, interval: CandleInterval, candles: Candle[]): Promise<number> {
    const key = this.key(source, symbol, interval);
    const rows = this.stored.get(key) ?? [];
    const existing = new Set(rows.map((c) => c.openTimeMs));
    const fresh = candles.filter((c) => !existing.has(c.openTimeMs));
    this.stored.set(key, [...rows, ...fresh].sort((a, b) => a.openTimeMs - b.openTimeMs));
    return fresh.length;
  }
}

describe('syncSymbolCandles', () => {
  it('fetches the full venue window on first sync', async () => {
    const adapter = new FakeAdapter({ AAAUSDC: [candle(T0), candle(T0 + H), candle(T0 + 2 * H)] });
    const repo = new FakeRepo();
    const report = await syncSymbolCandles(adapter, repo, 'AAAUSDC', '1h', T0 + 3 * H);
    expect(adapter.calls[0]!.opts).toBeUndefined();
    expect(report.inserted).toBe(3);
    expect(report.latestOpenTimeMs).toBe(T0 + 2 * H);
  });

  it('resumes strictly after the latest stored bar', async () => {
    const adapter = new FakeAdapter({ AAAUSDC: [candle(T0 + 2 * H), candle(T0 + 3 * H)] });
    const repo = new FakeRepo();
    await repo.insertCandles('fake', 'AAAUSDC', '1h', [candle(T0), candle(T0 + H)]);

    const report = await syncSymbolCandles(adapter, repo, 'AAAUSDC', '1h', T0 + 4 * H);
    expect(adapter.calls[0]!.opts?.sinceMs).toBe(T0 + 2 * H);
    expect(report.inserted).toBe(2);
    expect(report.latestOpenTimeMs).toBe(T0 + 3 * H);
  });

  it('drops a still-forming bar even if the adapter leaks one', async () => {
    const nowMs = T0 + 2 * H + 30 * 60_000; // bar at T0+2H is mid-formation
    const adapter = new FakeAdapter({ AAAUSDC: [candle(T0), candle(T0 + H), candle(T0 + 2 * H)] });
    const repo = new FakeRepo();
    const report = await syncSymbolCandles(adapter, repo, 'AAAUSDC', '1h', nowMs);
    expect(report.inserted).toBe(2);
    expect(report.latestOpenTimeMs).toBe(T0 + H);
  });

  it('re-running a completed sync inserts nothing', async () => {
    const adapter = new FakeAdapter({ AAAUSDC: [candle(T0), candle(T0 + H)] });
    const repo = new FakeRepo();
    const nowMs = T0 + 2 * H;
    await syncSymbolCandles(adapter, repo, 'AAAUSDC', '1h', nowMs);
    const second = await syncSymbolCandles(adapter, repo, 'AAAUSDC', '1h', nowMs);
    expect(second.fetched).toBe(0);
    expect(second.inserted).toBe(0);
  });
});

describe('syncCandles', () => {
  it('continues past per-symbol failures and reports them', async () => {
    const adapter = new FakeAdapter({
      AAAUSDC: [candle(T0)],
      BOOM: [candle(T0)],
      CCCUSDC: [candle(T0)],
    });
    const repo = new FakeRepo();
    const reports = await syncCandles(adapter, repo, ['AAAUSDC', 'BOOM', 'CCCUSDC'], {
      intervals: ['1h'],
      nowMs: T0 + H,
    });
    expect(reports).toHaveLength(3);
    expect(reports[1]!.error).toContain('venue exploded');
    expect(reports[0]!.inserted).toBe(1);
    expect(reports[2]!.inserted).toBe(1);
  });
});

describe('selectUniverse', () => {
  const markets: MarketRef[] = [
    { symbol: 'AAAUSDC', base: 'AAA', quote: 'USDC', venueSymbol: 'AAAUSDC' },
    { symbol: 'BBBUSDC', base: 'BBB', quote: 'USDC', venueSymbol: 'BBBUSDC' },
    { symbol: 'CCCUSDC', base: 'CCC', quote: 'USDC', venueSymbol: 'CCCUSDC' },
    { symbol: 'DDDUSD', base: 'DDD', quote: 'USD', venueSymbol: 'DDDUSD' },
  ];

  it('ranks by quote volume, filters by quote asset, and cuts at top-N', () => {
    const stats = new Map([
      ['AAAUSDC', { quoteVolume24h: 1_000, lastPrice: 1 }],
      ['BBBUSDC', { quoteVolume24h: 9_000, lastPrice: 1 }],
      ['CCCUSDC', { quoteVolume24h: 5_000, lastPrice: 1 }],
      ['DDDUSD', { quoteVolume24h: 99_000, lastPrice: 1 }],
    ]);
    const result = selectUniverse(markets, stats, { quote: 'USDC', top: 2 });
    expect(result.symbols).toEqual(['BBBUSDC', 'CCCUSDC']);
    expect(result.excludedByRank).toEqual(['AAAUSDC']);
  });

  it('applies the minimum-volume floor and drops dead markets', () => {
    const stats = new Map([
      ['AAAUSDC', { quoteVolume24h: 100, lastPrice: 1 }],
      ['BBBUSDC', { quoteVolume24h: 9_000, lastPrice: 0 }], // dead price
      ['CCCUSDC', { quoteVolume24h: 5_000, lastPrice: 1 }],
    ]);
    const result = selectUniverse(markets, stats, { quote: 'USDC', top: 10, minQuoteVolume24h: 1_000 });
    expect(result.symbols).toEqual(['CCCUSDC']);
  });

  it('ignores markets with no stats', () => {
    const result = selectUniverse(markets, new Map(), { quote: 'USDC', top: 5 });
    expect(result.symbols).toEqual([]);
  });
});
