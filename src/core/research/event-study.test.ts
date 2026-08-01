import { describe, expect, it } from 'vitest';

import {
  buildPriceSeries,
  forwardReturnPct,
  HOUR_MS,
  mulberry32,
  runEventStudy,
  runPerEventHorizonEdgeTest,
  type ResearchCandle,
  type ResearchEvent,
} from './event-study';

const START_MS = Date.UTC(2025, 0, 1);
const BAR_MS = 15 * 60 * 1000; // 15m bars
const BARS_PER_HOUR = 4;

interface SyntheticSpec {
  bars: number;
  seed?: number;
  noisePct?: number;
  /** Per-bar drift added to the running price, in %. */
  driftPct?: number;
  /** Multiplicative bump (%) applied to the bar's open, keyed by bar index. */
  bumps?: Map<number, number>;
}

/** Random-walk 15m series with optional planted bumps at specific bars. */
function buildSeries(spec: SyntheticSpec): ResearchCandle[] {
  const rand = mulberry32(spec.seed ?? 7);
  const noise = spec.noisePct ?? 0.05;
  const drift = spec.driftPct ?? 0;
  const candles: ResearchCandle[] = [];
  let price = 100;
  for (let i = 0; i < spec.bars; i += 1) {
    const step = (rand() - 0.5) * 2 * noise + drift;
    price = price * (1 + step / 100);
    const bump = spec.bumps?.get(i) ?? 0;
    candles.push({ openTimeMs: START_MS + i * BAR_MS, open: price * (1 + bump / 100) });
  }
  return candles;
}

function eventAtBar(bar: number, direction: 'LONG' | 'SHORT', features: Record<string, number> = {}): ResearchEvent {
  return { timestampMs: START_MS + bar * BAR_MS, symbol: 'TEST', direction, features };
}

const FAST = { permIterations: 200, permSeed: 3 } as const;

describe('buildPriceSeries', () => {
  it('sorts and infers the bar interval', () => {
    const series = buildPriceSeries('TEST', [
      { openTimeMs: START_MS + 2 * BAR_MS, open: 3 },
      { openTimeMs: START_MS, open: 1 },
      { openTimeMs: START_MS + BAR_MS, open: 2 },
    ]);
    expect(Array.from(series.opens)).toEqual([1, 2, 3]);
    expect(series.intervalMs).toBe(BAR_MS);
  });
});

describe('forwardReturnPct', () => {
  const series = buildPriceSeries('TEST', [
    { openTimeMs: START_MS, open: 100 },
    { openTimeMs: START_MS + BAR_MS, open: 101 },
    { openTimeMs: START_MS + 2 * BAR_MS, open: 102 },
    { openTimeMs: START_MS + 3 * BAR_MS, open: 103 },
    { openTimeMs: START_MS + 4 * BAR_MS, open: 104 },
  ]);

  it('computes a signed cost-adjusted LONG return', () => {
    // entry 100 → exit at +1h (bar 4) = 104 → +4% minus 0.1% cost.
    expect(forwardReturnPct(series, START_MS, HOUR_MS, 'LONG', 0.1)).toBeCloseTo(4 - 0.1, 6);
  });

  it('flips the sign for SHORT', () => {
    expect(forwardReturnPct(series, START_MS, HOUR_MS, 'SHORT', 0.1)).toBeCloseTo(-4 - 0.1, 6);
  });

  it('returns null when the exit lands past the series end', () => {
    expect(forwardReturnPct(series, START_MS + 3 * BAR_MS, HOUR_MS, 'LONG', 0)).toBeNull();
  });

  it('returns null when the exit falls on a data gap', () => {
    // A regular series (so the inferred interval is BAR_MS) with bars 20 & 21 removed.
    const candles: ResearchCandle[] = [];
    for (let i = 0; i < 60; i += 1) {
      if (i === 20 || i === 21) continue;
      candles.push({ openTimeMs: START_MS + i * BAR_MS, open: 100 + i });
    }
    const gapped = buildPriceSeries('TEST', candles);
    // Entry at bar 18, exit target at bar 20 (missing) → next bar is 22, gap > 1.5×interval.
    expect(forwardReturnPct(gapped, START_MS + 18 * BAR_MS, 2 * BAR_MS, 'LONG', 0)).toBeNull();
    // Sanity: a lookup landing on a present bar still measures.
    expect(forwardReturnPct(gapped, START_MS + 10 * BAR_MS, 2 * BAR_MS, 'LONG', 0)).not.toBeNull();
  });
});

describe('runEventStudy — edge test', () => {
  it('detects a real LONG edge (events precede an up-move)', () => {
    // Plant a +1.5% bump 4 bars (1h) after each event bar.
    const eventBars = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480];
    const bumps = new Map<number, number>();
    for (const b of eventBars) bumps.set(b + BARS_PER_HOUR, 1.5);
    const series = buildSeries({ bars: 600, bumps, noisePct: 0.04 });
    const events = eventBars.map((b) => eventAtBar(b, 'LONG'));

    const report = runEventStudy(
      new Map([['TEST', buildPriceSeries('TEST', series)]]),
      events,
      { horizons: [{ label: '1h', ms: HOUR_MS }], costPct: 0.1, ...FAST }
    );

    const edge = report.horizons[0]!.edge;
    expect(edge.meanNetReturnPct).toBeGreaterThan(1);
    expect(edge.permPValue).toBeLessThan(0.05);
  });

  it('reports no edge on pure noise', () => {
    const series = buildSeries({ bars: 600, noisePct: 0.06 });
    const events = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400].map((b) => eventAtBar(b, 'LONG'));

    const report = runEventStudy(
      new Map([['TEST', buildPriceSeries('TEST', series)]]),
      events,
      { horizons: [{ label: '4h', ms: 4 * HOUR_MS }], costPct: 0.1, ...FAST }
    );

    expect(report.horizons[0]!.edge.permPValue).toBeGreaterThan(0.1);
  });

  it('does not credit LONG drift as edge (null preserves direction)', () => {
    // Steady up-drift, events at random bars with NO special forward move.
    const series = buildSeries({ bars: 600, driftPct: 0.02, noisePct: 0.03 });
    const events = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500].map((b) => eventAtBar(b, 'LONG'));

    const report = runEventStudy(
      new Map([['TEST', buildPriceSeries('TEST', series)]]),
      events,
      { horizons: [{ label: '4h', ms: 4 * HOUR_MS }], costPct: 0.1, ...FAST }
    );

    // Mean may be positive from drift, but random LONG entries share it → not significant.
    expect(report.horizons[0]!.edge.permPValue).toBeGreaterThan(0.1);
  });

  it('lets round-trip cost kill a marginal edge', () => {
    const eventBars = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480];
    const bumps = new Map<number, number>();
    for (const b of eventBars) bumps.set(b + BARS_PER_HOUR, 0.08); // tiny +0.08% move
    const series = buildSeries({ bars: 600, bumps, noisePct: 0.02 });
    const events = eventBars.map((b) => eventAtBar(b, 'LONG'));
    const seriesMap = new Map([['TEST', buildPriceSeries('TEST', series)]]);

    const cheap = runEventStudy(seriesMap, events, { horizons: [{ label: '1h', ms: HOUR_MS }], costPct: 0, ...FAST });
    const costly = runEventStudy(seriesMap, events, { horizons: [{ label: '1h', ms: HOUR_MS }], costPct: 0.12, ...FAST });

    expect(cheap.horizons[0]!.edge.meanNetReturnPct).toBeGreaterThan(0);
    expect(costly.horizons[0]!.edge.meanNetReturnPct).toBeLessThan(0);
  });
});

describe('runEventStudy — feature test', () => {
  it('detects a feature that separates good from bad events', () => {
    // Feature `strength` linearly drives the forward bump: high strength → big up-move.
    const eventBars: number[] = [];
    for (let b = 40; b <= 560; b += 8) eventBars.push(b);
    const bumps = new Map<number, number>();
    const rand = mulberry32(11);
    const events: ResearchEvent[] = [];
    for (const b of eventBars) {
      const strength = rand();
      bumps.set(b + BARS_PER_HOUR, (strength - 0.5) * 3); // −1.5%..+1.5%
      events.push(eventAtBar(b, 'LONG', { strength }));
    }
    const series = buildSeries({ bars: 700, bumps, noisePct: 0.03 });

    const report = runEventStudy(
      new Map([['TEST', buildPriceSeries('TEST', series)]]),
      events,
      { horizons: [{ label: '1h', ms: HOUR_MS }], costPct: 0.1, featureBuckets: 5, ...FAST }
    );

    const feature = report.horizons[0]!.features.find((f) => f.feature === 'strength');
    expect(feature).toBeDefined();
    expect(feature!.spearman).toBeGreaterThan(0.4);
    expect(feature!.spreadTopMinusBottom).toBeGreaterThan(0);
    expect(feature!.permPValue).toBeLessThan(0.05);
  });

  it('reports a noise feature as insignificant', () => {
    const eventBars: number[] = [];
    for (let b = 40; b <= 560; b += 8) eventBars.push(b);
    const bumps = new Map<number, number>();
    for (const b of eventBars) bumps.set(b + BARS_PER_HOUR, 1.0); // same move regardless of feature
    const rand = mulberry32(99);
    const events = eventBars.map((b) => eventAtBar(b, 'LONG', { noise: rand() }));
    const series = buildSeries({ bars: 700, bumps, noisePct: 0.03 });

    const report = runEventStudy(
      new Map([['TEST', buildPriceSeries('TEST', series)]]),
      events,
      { horizons: [{ label: '1h', ms: HOUR_MS }], costPct: 0.1, featureBuckets: 5, ...FAST }
    );

    const feature = report.horizons[0]!.features.find((f) => f.feature === 'noise');
    expect(feature).toBeDefined();
    expect(feature!.permPValue).toBeGreaterThan(0.1);
  });
});

describe('runPerEventHorizonEdgeTest', () => {
  it("detects an edge measured at each event's own horizon", () => {
    // Bumps planted at DIFFERENT distances per event; each event's horizonMs
    // points exactly at its bump, so per-event measurement catches what a
    // single fixed horizon would smear out.
    const eventBars = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480];
    const bumps = new Map<number, number>();
    const events: Array<ResearchEvent & { horizonMs: number }> = [];
    for (let i = 0; i < eventBars.length; i += 1) {
      const bar = eventBars[i]!;
      const distanceBars = 2 + (i % 4) * 2; // 2,4,6,8 bars
      bumps.set(bar + distanceBars, 1.5);
      events.push({ ...eventAtBar(bar, 'LONG'), horizonMs: distanceBars * BAR_MS });
    }
    const seriesMap = new Map([['TEST', buildPriceSeries('TEST', buildSeries({ bars: 600, bumps, noisePct: 0.04 }))]]);

    const result = runPerEventHorizonEdgeTest(seriesMap, events, { costPct: 0.1, permIterations: 200, permSeed: 3 });
    expect(result.n).toBe(events.length);
    expect(result.meanNetReturnPct).toBeGreaterThan(1);
    expect(result.permPValue).toBeLessThan(0.05);
  });

  it('reports no edge on noise and stays deterministic', () => {
    const seriesMap = new Map([['TEST', buildPriceSeries('TEST', buildSeries({ bars: 600, noisePct: 0.06 }))]]);
    const events = [40, 90, 140, 190, 240, 290, 340, 390].map((b) => ({
      ...eventAtBar(b, 'LONG' as const),
      horizonMs: 4 * BAR_MS,
    }));
    const a = runPerEventHorizonEdgeTest(seriesMap, events, { costPct: 0.1, permIterations: 200, permSeed: 3 });
    const b = runPerEventHorizonEdgeTest(seriesMap, events, { costPct: 0.1, permIterations: 200, permSeed: 3 });
    expect(a.permPValue).toBeGreaterThan(0.1);
    expect(b).toEqual(a);
  });
});

describe('runEventStudy — determinism & bookkeeping', () => {
  it('is deterministic for a fixed seed', () => {
    const series = buildSeries({ bars: 400, noisePct: 0.05 });
    const seriesMap = new Map([['TEST', buildPriceSeries('TEST', series)]]);
    const events = [40, 80, 120, 160, 200, 240, 280].map((b) => eventAtBar(b, 'LONG', { f: b }));
    const a = runEventStudy(seriesMap, events, FAST);
    const b = runEventStudy(seriesMap, events, FAST);
    expect(b).toEqual(a);
  });

  it('counts measured vs total events per horizon (drops unmeasurable ones)', () => {
    const series = buildSeries({ bars: 200, noisePct: 0.05 });
    const seriesMap = new Map([['TEST', buildPriceSeries('TEST', series)]]);
    // Last event is too close to the end to measure a 24h horizon.
    const events = [40, 80, 120, 198].map((b) => eventAtBar(b, 'LONG'));
    const report = runEventStudy(seriesMap, events, {
      horizons: [{ label: '24h', ms: 24 * HOUR_MS }],
      ...FAST,
    });
    expect(report.totalEvents).toBe(4);
    expect(report.measuredByHorizon['24h']).toBeLessThan(4);
  });
});
