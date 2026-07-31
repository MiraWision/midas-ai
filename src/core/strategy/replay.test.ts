import { describe, expect, it } from 'vitest';

import type { Candle } from '../exchange/types';
import { CANDLE_INTERVAL_MS } from '../exchange/types';
import { smaCross } from '@/strategies/sma-cross';
import { replaySignals } from './replay';
import { simulateSignals } from './simulate';
import type { StrategyModule } from './types';

const H = CANDLE_INTERVAL_MS['1h'];
const T0 = Date.UTC(2026, 0, 1);

function series(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    openTimeMs: T0 + i * H,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

describe('replaySignals', () => {
  it('emits a crossover signal only after the crossing bar closes, no lookahead', () => {
    // Flat at 100 for 60 bars, then a step up to 110 → fast(4) crosses slow(16).
    const closes = [...Array(60).fill(100), ...Array(20).fill(110)];
    const candles = new Map([['AAAUSDC', series(closes)]]);
    const params = { fastBars: 4, slowBars: 16 };

    const { signals } = replaySignals(smaCross, params, candles, { interval: '1h', warmupBars: 20 });
    expect(signals.length).toBeGreaterThan(0);
    const first = signals[0]!;
    expect(first.direction).toBe('LONG');
    // The step happens at bar 60; the cross can only be seen once bar 60 closed.
    expect(first.entryMs).toBeGreaterThanOrEqual(T0 + 60 * H + H);
  });

  it('never lets a strategy see unclosed bars (verified via a spy strategy)', () => {
    let violations = 0;
    const spy: StrategyModule = {
      id: 'spy',
      name: 'spy',
      defaultParams: {},
      analyze(ctx) {
        for (const candles of ctx.candles.values()) {
          for (const candle of candles) {
            if (candle.openTimeMs + CANDLE_INTERVAL_MS[ctx.interval] > ctx.nowMs) violations += 1;
          }
        }
        return [];
      },
    };
    replaySignals(spy, {}, new Map([['AAAUSDC', series(Array(50).fill(100))]]), {
      interval: '1h',
      warmupBars: 0,
    });
    expect(violations).toBe(0);
  });

  it('dedupes identical signals across steps and discards past-stamped ones', () => {
    const sticky: StrategyModule = {
      id: 'sticky',
      name: 'sticky',
      defaultParams: {},
      analyze() {
        return [
          { symbol: 'AAAUSDC', direction: 'LONG' as const, entryMs: T0 + 10 * H }, // same every step; past for later steps
        ];
      },
    };
    const { signals } = replaySignals(sticky, {}, new Map([['AAAUSDC', series(Array(30).fill(100))]]), {
      interval: '1h',
      warmupBars: 0,
    });
    expect(signals).toHaveLength(1);
  });
});

describe('simulateSignals', () => {
  const sandbox = { quote: 'USDC', startingCash: 10_000, feeBps: 0, slippageBps: 0 };

  it('enters at the next bar open and exits after holdBars', () => {
    // Price 100 → jumps to 120 at bar 11 → entry fills at bar 10 open (100), exit at bar 14 open (120).
    const closes = [...Array(10).fill(100), 100, ...Array(10).fill(120)];
    const candles = new Map([['AAAUSDC', series(closes)]]);
    const signal = { symbol: 'AAAUSDC', direction: 'LONG' as const, entryMs: T0 + 10 * H };

    const result = simulateSignals([signal], candles, {
      interval: '1h',
      holdBars: 4,
      quotePerTrade: 1_000,
      sandbox,
    });
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]!.fillPrice).toBeCloseTo(100);
    expect(result.trades[1]!.fillPrice).toBeCloseTo(120);
    expect(result.totalReturnPct).toBeCloseTo(((1_000 / 100) * 20) / 100, 3); // +200 on 10k
  });

  it('skips SHORT signals and counts them', () => {
    const candles = new Map([['AAAUSDC', series(Array(30).fill(100))]]);
    const result = simulateSignals(
      [{ symbol: 'AAAUSDC', direction: 'SHORT', entryMs: T0 + 5 * H }],
      candles,
      { interval: '1h', holdBars: 2, quotePerTrade: 500, sandbox }
    );
    expect(result.trades).toHaveLength(0);
    expect(result.skippedShorts).toBe(1);
  });

  it('tracks drawdown through the equity curve', () => {
    // Entry at 100, price collapses to 50 (exit), recovers — drawdown must register.
    const closes = [100, 100, 100, 50, 50, 50, 100, 100];
    const candles = new Map([['AAAUSDC', series(closes)]]);
    const result = simulateSignals(
      [{ symbol: 'AAAUSDC', direction: 'LONG', entryMs: T0 + 2 * H }],
      candles,
      { interval: '1h', holdBars: 2, quotePerTrade: 5_000, sandbox }
    );
    expect(result.maxDrawdownPct).toBeGreaterThan(20);
    expect(result.finalEquity).toBeLessThan(10_000);
  });
});
