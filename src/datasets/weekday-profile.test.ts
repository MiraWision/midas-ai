import { describe, expect, it } from 'vitest';

import type { Candle } from '@/core/exchange/types';
import type { DatasetContext } from '@/core/datasets/types';
import { weekdayProfile } from './weekday-profile';

const H = 3_600_000;
// 2026-01-05 is a Monday.
const MONDAY = Date.UTC(2026, 0, 5);

function fakeContext(candlesBySymbol: Record<string, Candle[]>): DatasetContext {
  return {
    nowMs: MONDAY + 90 * 24 * H,
    symbols: async () => Object.keys(candlesBySymbol),
    candles: async (symbol) => candlesBySymbol[symbol] ?? [],
  };
}

/** Hourly candles for `days` days where every Monday gains, other days flat. */
function mondayPump(days: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let hour = 0; hour < days * 24; hour += 1) {
    const t = MONDAY + hour * H;
    const isMonday = new Date(t).getUTCDay() === 1;
    price = price * (1 + (isMonday ? 0.001 : 0)); // +0.1%/h on Mondays only
    candles.push({ openTimeMs: t, open: price, high: price, low: price, close: price, volume: 1 });
  }
  return candles;
}

describe('weekday-profile dataset', () => {
  it('surfaces a planted Monday effect and labels weekdays correctly', async () => {
    const rows = await weekdayProfile.build(fakeContext({ AAAUSDC: mondayPump(70) }), { returnBars: 24 });
    const byWeekday = new Map(rows.map((r) => [r.values.weekday, r]));
    expect(byWeekday.size).toBe(7);

    const monday = byWeekday.get('monday')!;
    const wednesday = byWeekday.get('wednesday')!;
    // 24h returns measured AT Monday bars look back across Sunday→Monday; the
    // pump makes returns ending on Monday/Tuesday larger than mid-week ones.
    expect(Number(monday.values.meanReturnPct)).toBeGreaterThan(Number(wednesday.values.meanReturnPct));
    expect(Number(monday.values.n)).toBeGreaterThan(100);
  });

  it('skips symbols with too little history', async () => {
    const rows = await weekdayProfile.build(fakeContext({ THIN: mondayPump(3) }), { returnBars: 24 });
    expect(rows).toHaveLength(0);
  });
});
