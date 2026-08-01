/**
 * Indicator library — pure, bar-aligned primitives.
 *
 * Conventions every indicator follows (and every custom indicator should):
 * - Input: candle arrays or number arrays, ascending by time.
 * - Output: number[] of the SAME length as the input, aligned by index;
 *   positions inside the warmup window are NaN — never silently truncated,
 *   so indexes always line up across indicators and candles.
 * - Pure and deterministic: no clocks, no I/O, no hidden state.
 *
 * Strategies compose these plus the combinators at the bottom (crossedAbove,
 * risingFor, …). If you need a new primitive, add it here with a test —
 * that's the platform extension point, not a per-strategy copy.
 */

import type { Candle } from '../exchange/types';

export function closes(candles: readonly Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** Simple moving average over `window` values. */
export function sma(values: readonly number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (window < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]!;
    if (i >= window) sum -= values[i - window]!;
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/** Exponential moving average (seeded with the SMA of the first window). */
export function ema(values: readonly number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (window < 1 || values.length < window) return out;
  const alpha = 2 / (window + 1);
  let seed = 0;
  for (let i = 0; i < window; i += 1) seed += values[i]!;
  out[window - 1] = seed / window;
  for (let i = window; i < values.length; i += 1) {
    out[i] = values[i]! * alpha + out[i - 1]! * (1 - alpha);
  }
  return out;
}

/** Wilder's RSI (0..100). */
export function rsi(values: readonly number[], window = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= window) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= window; i += 1) {
    const change = values[i]! - values[i - 1]!;
    if (change > 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / window;
  let avgLoss = loss / window;
  out[window] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = window + 1; i < values.length; i += 1) {
    const change = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (window - 1) + Math.max(change, 0)) / window;
    avgLoss = (avgLoss * (window - 1) + Math.max(-change, 0)) / window;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Average True Range (Wilder smoothing). */
export function atr(candles: readonly Candle[], window = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= window) return out;
  const tr = new Array<number>(candles.length).fill(NaN);
  tr[0] = candles[0]!.high - candles[0]!.low;
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  let seed = 0;
  for (let i = 1; i <= window; i += 1) seed += tr[i]!;
  out[window] = seed / window;
  for (let i = window + 1; i < candles.length; i += 1) {
    out[i] = (out[i - 1]! * (window - 1) + tr[i]!) / window;
  }
  return out;
}

/** Rolling population standard deviation. */
export function rollingStd(values: readonly number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (window < 2) return out;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    sum += v;
    sumSq += v * v;
    if (i >= window) {
      const old = values[i - window]!;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= window - 1) {
      const meanV = sum / window;
      out[i] = Math.sqrt(Math.max(sumSq / window - meanV * meanV, 0));
    }
  }
  return out;
}

/** Z-score of each value against its own rolling window. */
export function zscore(values: readonly number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const meanArr = sma(values, window);
  const stdArr = rollingStd(values, window);
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isFinite(meanArr[i]!) && stdArr[i]! > 0) out[i] = (values[i]! - meanArr[i]!) / stdArr[i]!;
  }
  return out;
}

/** Percent return over `lag` bars: (v[i] / v[i-lag] − 1) × 100. */
export function returnsPct(values: readonly number[], lag = 1): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = lag; i < values.length; i += 1) {
    const base = values[i - lag]!;
    if (base > 0) out[i] = (values[i]! / base - 1) * 100;
  }
  return out;
}

/* ------------------------------- combinators ------------------------------ */

/** true at index i when a crossed above b between bars i−1 and i. */
export function crossedAbove(a: readonly number[], b: readonly number[], i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1]!;
  const a1 = a[i]!;
  const b0 = b[i - 1]!;
  const b1 = b[i]!;
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) return false;
  return a0 <= b0 && a1 > b1;
}

/** true at index i when a crossed below b between bars i−1 and i. */
export function crossedBelow(a: readonly number[], b: readonly number[], i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1]!;
  const a1 = a[i]!;
  const b0 = b[i - 1]!;
  const b1 = b[i]!;
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) return false;
  return a0 >= b0 && a1 < b1;
}

/** true at index i when the series strictly rose over each of the last n steps. */
export function risingFor(values: readonly number[], i: number, n: number): boolean {
  if (i < n) return false;
  for (let k = i - n + 1; k <= i; k += 1) {
    const prev = values[k - 1]!;
    const curr = values[k]!;
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || curr <= prev) return false;
  }
  return true;
}
