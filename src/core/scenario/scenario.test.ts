import { describe, expect, it } from 'vitest';

import type { Candle } from '../exchange/types';
import { mulberry32, QUARTER_MS } from '../analysis/weekly-seasonality';
import { scenarioToStrategy } from './compile';
import type { ScenarioDefinition } from './types';

// 2026-01-05 is a Monday (UTC).
const MONDAY = Date.UTC(2026, 0, 5);
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** 15m random-walk with a pump planted every Tuesday 10:00–11:00 UTC. */
function tuesdayPump(weeks: number): Candle[] {
  const rand = mulberry32(7);
  const candles: Candle[] = [];
  let price = 100;
  for (let q = 0; q < weeks * 7 * 96; q += 1) {
    const t = MONDAY + q * QUARTER_MS;
    const date = new Date(t);
    const isPump = date.getUTCDay() === 2 && date.getUTCHours() === 10;
    const open = price;
    price = price * (1 + (isPump ? 0.4 : (rand() - 0.5) * 0.05) / 100);
    candles.push({ openTimeMs: t, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: 1 });
  }
  return candles;
}

const SEASONAL: ScenarioDefinition = {
  id: 'test-seasonal',
  name: 'test',
  interval: '15m',
  signal: { type: 'seasonal-windows', params: { weeksBack: 16 } },
};

describe('scenarioToStrategy — seasonal-windows', () => {
  it('compiles to a strategy that finds the planted Tuesday window, future-stamped with the segment horizon', () => {
    const strategy = scenarioToStrategy(SEASONAL);
    const weeks = 20;
    const nowMs = MONDAY + weeks * WEEK;
    const signals = strategy.analyze(
      { candles: new Map([['AAAUSDC', tuesdayPump(weeks)]]), interval: '15m', nowMs },
      strategy.defaultParams
    );

    const tuesday = signals.find((s) => new Date(s.entryMs).getUTCDay() === 2);
    expect(tuesday).toBeDefined();
    expect(tuesday!.direction).toBe('LONG');
    expect(tuesday!.entryMs).toBeGreaterThanOrEqual(nowMs);
    expect(new Date(tuesday!.entryMs).getUTCHours()).toBe(10);
    expect(tuesday!.horizonMs).toBeGreaterThanOrEqual(2 * QUARTER_MS);
    expect(tuesday!.horizonMs).toBeLessThanOrEqual(8 * QUARTER_MS);
  });

  it('respects the interval guard', () => {
    const strategy = scenarioToStrategy(SEASONAL);
    expect(
      strategy.analyze({ candles: new Map(), interval: '1h', nowMs: MONDAY }, strategy.defaultParams)
    ).toHaveLength(0);
  });
});

describe('scenarioToStrategy — indicator-cross', () => {
  it('compiles a declarative crossover and fires on the crossing bar', () => {
    const strategy = scenarioToStrategy({
      id: 'test-cross',
      name: 'test',
      signal: { type: 'indicator-cross', params: { fast: { fn: 'sma', window: 2 }, slow: { fn: 'sma', window: 4 } } },
    });
    const H = 3_600_000;
    const closesArr = [100, 100, 100, 100, 100, 100, 100, 120];
    const candles: Candle[] = closesArr.map((close, i) => ({
      openTimeMs: MONDAY + i * H,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    }));
    const signals = strategy.analyze(
      { candles: new Map([['AAAUSDC', candles]]), interval: '1h', nowMs: MONDAY + 8 * H },
      strategy.defaultParams
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]!.direction).toBe('LONG');
  });
});

describe('scenario validation', () => {
  it('rejects unknown generator types and bad ids with named errors', () => {
    expect(() => scenarioToStrategy({ id: 'x', name: 'x', signal: { type: 'nope' } })).toThrow(/unknown signal type/);
    expect(() => scenarioToStrategy({ id: 'Bad Id!', name: 'x', signal: { type: 'indicator-cross' } })).toThrow(
      /invalid id/
    );
  });
});
