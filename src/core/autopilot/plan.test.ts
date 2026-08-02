import { describe, expect, it } from 'vitest';

import type { StrategySignal } from '../strategy/types';
import { planTick, type OpenLot } from './plan';

const H = 3_600_000;
const NOW = Date.UTC(2026, 7, 2, 12);

function signal(symbol: string, entryMs = NOW, direction: 'LONG' | 'SHORT' = 'LONG', horizonMs?: number): StrategySignal {
  return { symbol, direction, entryMs, ...(horizonMs !== undefined ? { horizonMs } : {}) };
}

function lot(symbol: string, exitDueMs: number): OpenLot {
  return { symbol, quantity: 1, exitDueMs };
}

describe('planTick', () => {
  it('closes due lots and keeps the rest', () => {
    const plan = planTick({
      signals: [],
      openLots: [lot('AAAUSDC', NOW - 1), lot('BBBUSDC', NOW + H)],
      nowMs: NOW,
      intervalMs: H,
      fallbackHoldMs: 24 * H,
    });
    expect(plan.toClose.map((l) => l.symbol)).toEqual(['AAAUSDC']);
  });

  it('opens fresh LONGs with horizonMs winning over the fallback', () => {
    const plan = planTick({
      signals: [signal('AAAUSDC', NOW, 'LONG', 6 * H), signal('BBBUSDC')],
      openLots: [],
      nowMs: NOW,
      intervalMs: H,
      fallbackHoldMs: 24 * H,
    });
    expect(plan.toOpen).toHaveLength(2);
    expect(plan.toOpen[0]!.exitDueMs).toBe(NOW + 6 * H);
    expect(plan.toOpen[1]!.exitDueMs).toBe(NOW + 24 * H);
  });

  it('skips stale signals, shorts, and symbols already held', () => {
    const plan = planTick({
      signals: [
        signal('OLDUSDC', NOW - 3 * H), // stale
        signal('SHRTUSDC', NOW, 'SHORT'),
        signal('HELDUSDC'), // lot still open
        signal('HELDUSDC'), // duplicate within the same tick
      ],
      openLots: [lot('HELDUSDC', NOW + H)],
      nowMs: NOW,
      intervalMs: H,
      fallbackHoldMs: 24 * H,
    });
    expect(plan.toOpen).toHaveLength(0);
    expect(plan.skippedStale).toBe(1);
    expect(plan.skippedShorts).toBe(1);
    expect(plan.skippedAlreadyOpen).toBe(2);
  });

  it('a lot being closed this tick does not block a re-entry', () => {
    const plan = planTick({
      signals: [signal('AAAUSDC')],
      openLots: [lot('AAAUSDC', NOW - 1)],
      nowMs: NOW,
      intervalMs: H,
      fallbackHoldMs: 24 * H,
    });
    expect(plan.toClose).toHaveLength(1);
    expect(plan.toOpen).toHaveLength(1);
  });
});
