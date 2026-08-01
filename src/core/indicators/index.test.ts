import { describe, expect, it } from 'vitest';

import type { Candle } from '../exchange/types';
import { atr, crossedAbove, crossedBelow, ema, returnsPct, risingFor, rollingStd, rsi, sma, zscore } from './index';

describe('sma', () => {
  it('matches hand-computed values and NaN-pads the warmup', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(2);
    expect(out[4]).toBeCloseTo(4);
    expect(out).toHaveLength(5);
  });
});

describe('ema', () => {
  it('seeds with the SMA and converges toward the latest values', () => {
    const out = ema([1, 2, 3, 4, 5, 6], 3);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(2); // seed = SMA(1,2,3)
    expect(out[3]).toBeCloseTo(2 + (4 - 2) * 0.5); // alpha = 2/(3+1)
    expect(out[5]!).toBeGreaterThan(out[3]!);
  });
});

describe('rsi', () => {
  it('is 100 on a pure uptrend and ~0 on a pure downtrend', () => {
    const up = rsi(Array.from({ length: 20 }, (_, i) => 100 + i), 14);
    const down = rsi(Array.from({ length: 20 }, (_, i) => 100 - i), 14);
    expect(up[19]).toBeCloseTo(100);
    expect(down[19]!).toBeLessThan(1);
    expect(up[13]).toBeNaN();
  });

  it('sits near 50 on alternating equal moves', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + (i % 2)); // +1/−1 alternation
    const out = rsi(values, 14);
    expect(out[29]!).toBeGreaterThan(40);
    expect(out[29]!).toBeLessThan(60);
  });
});

describe('atr', () => {
  it('equals the constant bar range on a flat-range series', () => {
    const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      openTimeMs: i,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1,
    }));
    const out = atr(candles, 14);
    expect(out[13]).toBeNaN();
    expect(out[19]).toBeCloseTo(4);
  });
});

describe('rollingStd / zscore', () => {
  it('rollingStd is 0 on a constant series and positive on a varying one', () => {
    expect(rollingStd([5, 5, 5, 5, 5], 3)[4]).toBeCloseTo(0);
    expect(rollingStd([1, 5, 1, 5, 1], 4)[4]!).toBeGreaterThan(1);
  });

  it('zscore flags a spike against its own window', () => {
    const values = [...Array(20).fill(100), 110];
    const out = zscore(values, 10);
    expect(out[20]!).toBeGreaterThan(2);
  });
});

describe('returnsPct', () => {
  it('computes lagged percent returns', () => {
    const out = returnsPct([100, 110, 121], 1);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeCloseTo(10);
    expect(out[2]).toBeCloseTo(10);
  });
});

describe('combinators', () => {
  const fast = [NaN, 1, 3, 5, 4];
  const slow = [NaN, 2, 2, 2, 4.5];

  it('crossedAbove fires only on the crossing bar and never on NaN warmup', () => {
    expect(crossedAbove(fast, slow, 2)).toBe(true); // 1<=2 → 3>2
    expect(crossedAbove(fast, slow, 3)).toBe(false); // already above
    expect(crossedAbove(fast, slow, 1)).toBe(false); // prev is NaN
  });

  it('crossedBelow mirrors it', () => {
    expect(crossedBelow(fast, slow, 4)).toBe(true); // 5>=2 → 4<4.5
  });

  it('risingFor requires strict rises across the whole lookback', () => {
    const values = [1, 2, 3, 4, 4];
    expect(risingFor(values, 3, 3)).toBe(true);
    expect(risingFor(values, 4, 2)).toBe(false); // flat last step
  });
});
