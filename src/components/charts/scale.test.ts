import { describe, expect, it } from 'vitest';

import { linearScale, niceTicks, seriesPath, tickDecimals } from './scale';

describe('linearScale', () => {
  it('maps the domain onto pixels, including inverted ranges (SVG y)', () => {
    const y = linearScale(0, 100, 400, 0); // higher value → smaller y
    expect(y.toPx(0)).toBe(400);
    expect(y.toPx(100)).toBe(0);
    expect(y.toPx(50)).toBe(200);
  });

  it('survives a degenerate domain', () => {
    const s = linearScale(5, 5, 0, 100);
    expect(Number.isFinite(s.toPx(5))).toBe(true);
  });
});

describe('niceTicks', () => {
  it('produces round steps covering the domain', () => {
    const ticks = niceTicks(97, 213, 5);
    expect(ticks[0]!).toBeGreaterThanOrEqual(97);
    expect(ticks[ticks.length - 1]!).toBeLessThanOrEqual(213);
    const step = ticks[1]! - ticks[0]!;
    expect([10, 20, 25, 50]).toContain(step);
  });

  it('handles small fractional domains', () => {
    const ticks = niceTicks(1.1421, 1.1497, 5);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.every((t) => t >= 1.1421 && t <= 1.1497)).toBe(true);
  });
});

describe('seriesPath', () => {
  const xAt = (i: number) => i * 10;
  const yAt = (v: number) => 100 - v;

  it('breaks the path at NaN gaps instead of bridging them', () => {
    const path = seriesPath([NaN, 1, 2, NaN, 4], xAt, yAt);
    expect(path).toBe('M10.00,99.00L20.00,98.00M40.00,96.00');
  });

  it('is empty for all-NaN input', () => {
    expect(seriesPath([NaN, NaN], xAt, yAt)).toBe('');
  });
});

describe('tickDecimals', () => {
  it('scales decimals to the step size', () => {
    expect(tickDecimals(500)).toBe(0);
    expect(tickDecimals(5)).toBe(1);
    expect(tickDecimals(0.05)).toBe(3);
  });
});
