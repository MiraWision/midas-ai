/** Server-side loaders for the /charts explorer. */

import { and, desc, eq } from 'drizzle-orm';

import type { Candle, CandleInterval } from '@/core/exchange/types';
import { db } from '@/db';
import { marketCandles } from '@/db/schema';

export async function loadRecentCandles(
  source: string,
  symbol: string,
  interval: CandleInterval,
  bars: number
): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(marketCandles)
    .where(
      and(eq(marketCandles.source, source), eq(marketCandles.symbol, symbol), eq(marketCandles.interval, interval))
    )
    .orderBy(desc(marketCandles.openTimeMs))
    .limit(bars);
  return rows
    .reverse()
    .map((r) => ({ openTimeMs: r.openTimeMs, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}
