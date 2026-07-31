/**
 * Drizzle implementations of the market persistence contracts
 * (src/core/market/types.ts). Kept intentionally thin: all sync logic lives
 * in core and is tested against fakes; this file only touches SQL.
 */

import { and, asc, desc, eq } from 'drizzle-orm';

import type { Candle, CandleInterval } from '@/core/exchange/types';
import type { CandleRepository, UniverseRepository } from '@/core/market/types';
import { db } from '@/db';
import { marketCandles, trackedMarkets } from '@/db/schema';

export const candleRepository: CandleRepository = {
  async latestOpenTimeMs(source, symbol, interval) {
    const rows = await db
      .select({ openTimeMs: marketCandles.openTimeMs })
      .from(marketCandles)
      .where(
        and(eq(marketCandles.source, source), eq(marketCandles.symbol, symbol), eq(marketCandles.interval, interval))
      )
      .orderBy(desc(marketCandles.openTimeMs))
      .limit(1);
    return rows[0]?.openTimeMs ?? null;
  },

  async insertCandles(source: string, symbol: string, interval: CandleInterval, candles: Candle[]) {
    if (candles.length === 0) return 0;
    const inserted = await db
      .insert(marketCandles)
      .values(
        candles.map((c) => ({
          source,
          symbol,
          interval,
          openTimeMs: c.openTimeMs,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
      )
      .onConflictDoNothing()
      .returning({ openTimeMs: marketCandles.openTimeMs });
    return inserted.length;
  },
};

export const universeRepository: UniverseRepository = {
  async listEnabled(source) {
    const rows = await db
      .select({ symbol: trackedMarkets.symbol })
      .from(trackedMarkets)
      .where(and(eq(trackedMarkets.source, source), eq(trackedMarkets.enabled, true)))
      .orderBy(asc(trackedMarkets.symbol));
    return rows.map((r) => r.symbol);
  },

  async addMissing(source, symbols) {
    if (symbols.length === 0) return 0;
    const inserted = await db
      .insert(trackedMarkets)
      .values(symbols.map((symbol) => ({ source, symbol })))
      .onConflictDoNothing()
      .returning({ symbol: trackedMarkets.symbol });
    return inserted.length;
  },
};
