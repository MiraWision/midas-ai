/**
 * Weekday return profile — a REFERENCE dataset, not a finding.
 *
 * For each tracked symbol × UTC weekday: mean and std of 24h close-to-close
 * returns and the sample count. It exists to show the DatasetDefinition
 * contract end to end; whether any weekday effect is real is a question for
 * a pre-registered hypothesis, not for this table. (Gate #5 applies the
 * moment you scan 7 weekdays × N symbols and pick the shiniest cell.)
 */

import type { DatasetContext, DatasetDefinition, DatasetRow } from '@/core/datasets/types';
import { returnsPct } from '@/core/indicators';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export interface WeekdayProfileParams extends Record<string, unknown> {
  /** Bars per return observation at 1h resolution (24 = daily returns). */
  returnBars: number;
}

export const weekdayProfile: DatasetDefinition<WeekdayProfileParams> = {
  id: 'weekday-profile',
  name: 'Weekday return profile (reference example)',
  description: 'Per symbol × UTC weekday: mean/std of 24h returns and sample size, from 1h candles.',
  columns: [
    { name: 'symbol', type: 'string' },
    { name: 'weekday', type: 'string', description: 'UTC day of week' },
    { name: 'meanReturnPct', type: 'number', description: 'mean 24h close-to-close return, %' },
    { name: 'stdReturnPct', type: 'number' },
    { name: 'n', type: 'number', description: 'observations' },
  ],
  defaultParams: { returnBars: 24 },

  async build(ctx: DatasetContext, params: WeekdayProfileParams): Promise<DatasetRow[]> {
    const rows: DatasetRow[] = [];
    for (const symbol of await ctx.symbols()) {
      const candles = await ctx.candles(symbol, '1h');
      if (candles.length < params.returnBars * 8) continue; // too thin to profile

      const rets = returnsPct(candles.map((c) => c.close), params.returnBars);
      const byWeekday = new Map<number, number[]>();
      for (let i = 0; i < candles.length; i += 1) {
        const ret = rets[i]!;
        if (!Number.isFinite(ret)) continue;
        const weekday = new Date(candles[i]!.openTimeMs).getUTCDay();
        const bucket = byWeekday.get(weekday) ?? [];
        bucket.push(ret);
        byWeekday.set(weekday, bucket);
      }

      for (const [weekday, values] of byWeekday) {
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
        rows.push({
          key: symbol,
          timestampMs: Date.UTC(1970, 0, 4 + weekday), // stable per-weekday anchor
          values: {
            symbol,
            weekday: WEEKDAYS[weekday]!,
            meanReturnPct: mean,
            stdReturnPct: Math.sqrt(variance),
            n: values.length,
          },
        });
      }
    }
    return rows;
  },
};
