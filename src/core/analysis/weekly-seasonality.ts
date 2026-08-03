/**
 * Trace engine — the canonical Echo strategy core.
 *
 * Model: overlay the last N weeks of 15m returns as weekly traces, weight each
 * week by exp(-lambda * ageWeeks), and search every contiguous intraday window
 * (per UTC weekday) for segments where the weighted mean move clears trading
 * costs with a statistically significant margin:
 *
 *   tStat = (|weightedMean| - costPct) / (weightedStd / sqrt(effectiveN))
 *
 * Significance is calibrated per dataset with a permutation test: each week's
 * trace is circularly shifted by a random offset (breaking time-of-day
 * alignment while preserving the week's autocorrelation and weight), and the
 * max tStat found in shuffled data forms the null distribution. Only real
 * segments beating the chosen null quantile survive.
 *
 * Segment returns are window-relative (compounded from entry to exit within
 * each week), so a week where price fell 3% before the window and a week where
 * it was flat contribute identically if the move inside the window matches.
 *
 * Pure and in-memory: the same code backs live analysis, the API, and the
 * walk-forward backtest.
 */

export type TraceDirection = 'LONG' | 'SHORT';

export const QUARTER_MS = 15 * 60 * 1000;
export const QUARTERS_PER_DAY = 96;
export const QUARTERS_PER_WEEK = 7 * QUARTERS_PER_DAY;
export const WEEK_MS = QUARTERS_PER_WEEK * QUARTER_MS;

const STD_EPS = 1e-9;
/** Stand-in tStat for the degenerate zero-variance case. */
const T_STAT_DEGENERATE = 1e6;

export interface TraceCandle {
  openTime: Date;
  open: number;
  close: number;
}

export interface WeekTrace {
  /** 0 = the week containing referenceMs (possibly partial). */
  ageWeeks: number;
  weekStartMs: number;
  /** exp(-lambdaDecay * ageWeeks), unnormalized. */
  weight: number;
  /** Per-quarter log returns for the whole week (Mon 00:00 → Sun 23:45); NaN = missing. */
  logReturns: Float64Array;
}

export interface TraceEngineParams {
  /** Per-week exponential decay of a week's weight. */
  lambdaDecay: number;
  /** How many weeks of history to overlay. */
  weeksBack: number;
  minSegmentQuarters: number;
  maxSegmentQuarters: number;
  /** Min empty quarters between two selected segments on the same weekday. */
  segmentGapQuarters: number;
  /** A window needs at least this many weeks with complete data to qualify. */
  minValidWeeks: number;
  /** ...and at least this Kish effective sample size (weights considered). */
  minEffectiveWeeks: number;
  /** Round-trip friction (fees + slippage) in %, subtracted before the t-stat. */
  costPct: number;
  /** Null-distribution quantile a real segment must beat (e.g. 0.95). */
  permQuantile: number;
  permIterations: number;
  permSeed: number;
}

export const DEFAULT_TRACE_PARAMS: TraceEngineParams = {
  lambdaDecay: 0.05,
  weeksBack: 26,
  minSegmentQuarters: 2,
  maxSegmentQuarters: 32,
  segmentGapQuarters: 2,
  minValidWeeks: 8,
  minEffectiveWeeks: 6,
  costPct: 0.12,
  permQuantile: 0.95,
  permIterations: 200,
  permSeed: 1,
};

export interface SegmentStats {
  /** Weighted mean window return, %, signed. */
  meanReturnPct: number;
  stdReturnPct: number;
  effN: number;
  validWeeks: number;
  /** Weighted share of weeks whose window return matches `direction`. */
  winShare: number;
  direction: TraceDirection;
  /** |meanReturnPct| - costPct. */
  netEdgePct: number;
  tStat: number;
}

export interface TraceSegment {
  utcWeekday: number;
  /** Quarter-of-day indices, inclusive on both ends (0..95). */
  startQuarter: number;
  endQuarter: number;
  stats: SegmentStats;
  /** Fraction of null maxima strictly below this segment's tStat (0..1). */
  confidence: number;
  /** Legacy freshness metric: last-4-weeks mean vs the weighted mean. */
  patternFreshness: number | null;
}

export interface TraceAnalysisResult {
  weeks: WeekTrace[];
  segments: TraceSegment[];
  /** Resolved tStat threshold (null-maxima quantile). */
  permThreshold: number;
  params: TraceEngineParams;
}

/* --------------------------------- helpers -------------------------------- */

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monday 00:00 UTC boundary at or before the given time. */
export function mondayStartMs(ms: number): number {
  const date = new Date(ms);
  const weekday = (date.getUTCDay() + 6) % 7;
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return dayStart - weekday * 24 * 60 * 60 * 1000;
}

/* ------------------------------- week traces ------------------------------ */

export function buildWeekTraces(
  candles: TraceCandle[],
  referenceMs: number,
  params: Pick<TraceEngineParams, 'lambdaDecay' | 'weeksBack'>
): WeekTrace[] {
  const refWeekStart = mondayStartMs(referenceMs);
  const weeks: WeekTrace[] = [];
  const byStart = new Map<number, WeekTrace>();
  for (let age = 0; age < params.weeksBack; age += 1) {
    const week: WeekTrace = {
      ageWeeks: age,
      weekStartMs: refWeekStart - age * WEEK_MS,
      weight: Math.exp(-params.lambdaDecay * age),
      logReturns: new Float64Array(QUARTERS_PER_WEEK).fill(Number.NaN),
    };
    weeks.push(week);
    byStart.set(week.weekStartMs, week);
  }

  for (const candle of candles) {
    const ms = candle.openTime.getTime();
    if (ms >= referenceMs) continue;
    const week = byStart.get(mondayStartMs(ms));
    if (!week) continue;
    const quarter = Math.floor((ms - week.weekStartMs) / QUARTER_MS);
    if (quarter < 0 || quarter >= QUARTERS_PER_WEEK) continue;
    if (!Number.isFinite(candle.open) || !Number.isFinite(candle.close)) continue;
    if (candle.open <= 0 || candle.close <= 0) continue;
    week.logReturns[quarter] = Math.log(candle.close / candle.open);
  }

  return weeks;
}

/* --------------------------- windowed statistics --------------------------- */

interface WeekPrefix {
  weight: number;
  ageWeeks: number;
  /** sum[i] = Σ logReturns[0..i-1] with NaN treated as 0. */
  sum: Float64Array;
  /** bad[i] = count of NaN in [0..i-1]. */
  bad: Int32Array;
}

function buildPrefixes(weeks: WeekTrace[]): WeekPrefix[] {
  return weeks.map((week) => {
    const sum = new Float64Array(QUARTERS_PER_WEEK + 1);
    const bad = new Int32Array(QUARTERS_PER_WEEK + 1);
    for (let i = 0; i < QUARTERS_PER_WEEK; i += 1) {
      const value = week.logReturns[i]!;
      const missing = Number.isNaN(value);
      sum[i + 1] = sum[i]! + (missing ? 0 : value);
      bad[i + 1] = bad[i]! + (missing ? 1 : 0);
    }
    return { weight: week.weight, ageWeeks: week.ageWeeks, sum, bad };
  });
}

/**
 * Window return (%) for one week over global quarters [start..end] (inclusive),
 * read at a circular shift; null when any quarter in range is missing.
 */
function windowReturnPct(prefix: WeekPrefix, start: number, end: number, shift: number): number | null {
  const from = (start + shift) % QUARTERS_PER_WEEK;
  const to = (end + shift) % QUARTERS_PER_WEEK;
  let logSum: number;
  if (from <= to) {
    if (prefix.bad[to + 1]! - prefix.bad[from]! > 0) return null;
    logSum = prefix.sum[to + 1]! - prefix.sum[from]!;
  } else {
    const badWrap =
      prefix.bad[QUARTERS_PER_WEEK]! - prefix.bad[from]! + prefix.bad[to + 1]! - prefix.bad[0]!;
    if (badWrap > 0) return null;
    logSum =
      prefix.sum[QUARTERS_PER_WEEK]! - prefix.sum[from]! + prefix.sum[to + 1]! - prefix.sum[0]!;
  }
  return (Math.exp(logSum) - 1) * 100;
}

export interface WindowStatsInput {
  minValidWeeks: number;
  minEffectiveWeeks: number;
  costPct: number;
}

/** Weighted stats over one window; null when the sample does not qualify. */
function computeWindowStats(
  prefixes: WeekPrefix[],
  start: number,
  end: number,
  shifts: Int32Array | null,
  input: WindowStatsInput
): SegmentStats | null {
  let weightSum = 0;
  let weightSqSum = 0;
  let weightedReturnSum = 0;
  let validWeeks = 0;
  const values: number[] = [];
  const weights: number[] = [];

  for (let i = 0; i < prefixes.length; i += 1) {
    const prefix = prefixes[i]!;
    const shift = shifts ? shifts[i]! : 0;
    const value = windowReturnPct(prefix, start, end, shift);
    if (value === null) continue;
    validWeeks += 1;
    weightSum += prefix.weight;
    weightSqSum += prefix.weight * prefix.weight;
    weightedReturnSum += prefix.weight * value;
    values.push(value);
    weights.push(prefix.weight);
  }

  if (validWeeks < input.minValidWeeks || weightSum <= 0) return null;
  const effN = (weightSum * weightSum) / weightSqSum;
  if (effN < input.minEffectiveWeeks) return null;

  const meanReturnPct = weightedReturnSum / weightSum;
  let varianceSum = 0;
  let winWeight = 0;
  const direction: TraceDirection = meanReturnPct >= 0 ? 'LONG' : 'SHORT';
  for (let i = 0; i < values.length; i += 1) {
    const diff = values[i]! - meanReturnPct;
    varianceSum += weights[i]! * diff * diff;
    const wins = direction === 'LONG' ? values[i]! > 0 : values[i]! < 0;
    if (wins) winWeight += weights[i]!;
  }
  const stdReturnPct = Math.sqrt(varianceSum / weightSum);
  const netEdgePct = Math.abs(meanReturnPct) - input.costPct;

  let tStat: number;
  if (stdReturnPct < STD_EPS) {
    tStat = netEdgePct > 0 ? T_STAT_DEGENERATE : 0;
  } else {
    tStat = netEdgePct / (stdReturnPct / Math.sqrt(effN));
  }

  return {
    meanReturnPct,
    stdReturnPct,
    effN,
    validWeeks,
    winShare: winWeight / weightSum,
    direction,
    netEdgePct,
    tStat,
  };
}

/* ------------------------------ segment search ----------------------------- */

interface WindowCandidate {
  utcWeekday: number;
  startQuarter: number;
  endQuarter: number;
  stats: SegmentStats;
}

function forEachWindow(
  params: TraceEngineParams,
  visit: (weekday: number, startGlobal: number, endGlobal: number, startQuarter: number, endQuarter: number) => void
): void {
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const base = weekday * QUARTERS_PER_DAY;
    for (let start = 0; start < QUARTERS_PER_DAY; start += 1) {
      const maxLen = Math.min(params.maxSegmentQuarters, QUARTERS_PER_DAY - start);
      for (let len = params.minSegmentQuarters; len <= maxLen; len += 1) {
        const end = start + len - 1;
        visit(weekday, base + start, base + end, start, end);
      }
    }
  }
}

function collectCandidates(prefixes: WeekPrefix[], params: TraceEngineParams): WindowCandidate[] {
  const candidates: WindowCandidate[] = [];
  forEachWindow(params, (weekday, startGlobal, endGlobal, startQuarter, endQuarter) => {
    const stats = computeWindowStats(prefixes, startGlobal, endGlobal, null, params);
    if (!stats || stats.netEdgePct <= 0 || stats.tStat <= 0) return;
    candidates.push({ utcWeekday: weekday, startQuarter, endQuarter, stats });
  });
  return candidates;
}

function maxNullTStat(prefixes: WeekPrefix[], params: TraceEngineParams, shifts: Int32Array): number {
  let max = 0;
  forEachWindow(params, (_weekday, startGlobal, endGlobal) => {
    const stats = computeWindowStats(prefixes, startGlobal, endGlobal, shifts, params);
    if (stats && stats.netEdgePct > 0 && stats.tStat > max) max = stats.tStat;
  });
  return max;
}

/** Null distribution of best-in-dataset tStat under circular week shifts. */
export function computeNullMaxima(weeks: WeekTrace[], params: TraceEngineParams): number[] {
  const prefixes = buildPrefixes(weeks);
  const random = mulberry32(params.permSeed);
  const maxima: number[] = [];
  const shifts = new Int32Array(prefixes.length);
  for (let iteration = 0; iteration < params.permIterations; iteration += 1) {
    for (let i = 0; i < shifts.length; i += 1) {
      shifts[i] = Math.floor(random() * QUARTERS_PER_WEEK);
    }
    maxima.push(maxNullTStat(prefixes, params, shifts));
  }
  return maxima.sort((a, b) => a - b);
}

function quantileOfSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index]!;
}

function selectNonOverlapping(candidates: WindowCandidate[], gapQuarters: number): WindowCandidate[] {
  const sorted = candidates
    .slice()
    .sort(
      (a, b) =>
        b.stats.tStat - a.stats.tStat ||
        b.stats.netEdgePct - a.stats.netEdgePct ||
        a.endQuarter - a.startQuarter - (b.endQuarter - b.startQuarter)
    );
  const taken: WindowCandidate[] = [];
  for (const candidate of sorted) {
    const overlaps = taken.some(
      (other) =>
        other.utcWeekday === candidate.utcWeekday &&
        candidate.startQuarter <= other.endQuarter + gapQuarters &&
        candidate.endQuarter >= other.startQuarter - gapQuarters
    );
    if (!overlaps) taken.push(candidate);
  }
  return taken.sort(
    (a, b) => a.utcWeekday - b.utcWeekday || a.startQuarter - b.startQuarter
  );
}

const FOUR_WEEKS = 4;

function computeFreshness(
  prefixes: WeekPrefix[],
  candidate: WindowCandidate
): number | null {
  const base = candidate.utcWeekday * QUARTERS_PER_DAY;
  const start = base + candidate.startQuarter;
  const end = base + candidate.endQuarter;
  let recentSum = 0;
  let recentCount = 0;
  for (const prefix of prefixes) {
    if (prefix.ageWeeks >= FOUR_WEEKS) continue;
    const value = windowReturnPct(prefix, start, end, 0);
    if (value === null) continue;
    recentSum += value;
    recentCount += 1;
  }
  if (recentCount === 0) return null;
  const recentMean = recentSum / recentCount;
  const baseMean = candidate.stats.meanReturnPct;
  const raw = 1 - Math.abs(recentMean - baseMean) / (Math.abs(baseMean) + 0.1);
  return Math.max(0, Math.min(1, raw));
}

/* --------------------------------- analyze -------------------------------- */

export function analyzeTraces(
  candles: TraceCandle[],
  referenceMs: number,
  paramsInput?: Partial<TraceEngineParams>
): TraceAnalysisResult {
  const params: TraceEngineParams = { ...DEFAULT_TRACE_PARAMS, ...paramsInput };
  const weeks = buildWeekTraces(candles, referenceMs, params);
  const prefixes = buildPrefixes(weeks);

  const candidates = collectCandidates(prefixes, params);
  const nullMaxima = candidates.length > 0 ? computeNullMaxima(weeks, params) : [];
  const permThreshold = quantileOfSorted(nullMaxima, params.permQuantile);

  const significant = candidates.filter((candidate) => candidate.stats.tStat >= permThreshold);
  const segments = selectNonOverlapping(significant, params.segmentGapQuarters).map((candidate) => {
    let below = 0;
    for (const value of nullMaxima) {
      if (value < candidate.stats.tStat) below += 1;
      else break;
    }
    return {
      utcWeekday: candidate.utcWeekday,
      startQuarter: candidate.startQuarter,
      endQuarter: candidate.endQuarter,
      stats: candidate.stats,
      confidence: nullMaxima.length > 0 ? below / nullMaxima.length : 0,
      patternFreshness: computeFreshness(prefixes, candidate),
    };
  });

  return { weeks, segments, permThreshold, params };
}

/* ------------------------------ visualization ------------------------------ */

export interface WeekdayCurve {
  ageWeeks: number;
  weight: number;
  /** 97 cumulative points (%), starting at 0; null after the first missing quarter. */
  cumulativePct: Array<number | null>;
}

/** Cumulative intraday curves for one weekday, anchored at 0 at day start. */
export function weekdayCurves(weeks: WeekTrace[], utcWeekday: number): WeekdayCurve[] {
  const base = utcWeekday * QUARTERS_PER_DAY;
  return weeks.map((week) => {
    const points: Array<number | null> = [0];
    let logSum = 0;
    let broken = false;
    for (let q = 0; q < QUARTERS_PER_DAY; q += 1) {
      const value = week.logReturns[base + q]!;
      if (broken || Number.isNaN(value)) {
        broken = true;
        points.push(null);
        continue;
      }
      logSum += value;
      points.push((Math.exp(logSum) - 1) * 100);
    }
    return { ageWeeks: week.ageWeeks, weight: week.weight, cumulativePct: points };
  });
}

/** Pointwise weighted mean of the weekday curves (null where no week has data). */
export function weekdayMeanCurve(curves: WeekdayCurve[]): Array<number | null> {
  const points: Array<number | null> = [];
  for (let i = 0; i <= QUARTERS_PER_DAY; i += 1) {
    let weightSum = 0;
    let valueSum = 0;
    for (const curve of curves) {
      const value = curve.cumulativePct[i];
      if (value === null || value === undefined) continue;
      weightSum += curve.weight;
      valueSum += curve.weight * value;
    }
    points.push(weightSum > 0 ? valueSum / weightSum : null);
  }
  return points;
}
