/**
 * Event-study harness — the shared "rails" for validating trading ideas.
 *
 * Given a set of *events* (a timestamp + symbol + hypothesized direction + a
 * feature snapshot) and the price series they live in, it answers two
 * questions with permutation-based significance rather than eyeballing:
 *
 *   1. Edge test — "do these events, entered in their hypothesized direction,
 *      beat entering at random times?" (guards against drift masquerading as
 *      alpha: the null preserves the direction mix and only randomizes timing.)
 *
 *   2. Feature test — "does feature X separate high-forward-return events from
 *      low ones?" (the null shuffles the feature values across events, breaking
 *      feature↔outcome while preserving both marginals.)
 *
 * Forward returns are open-to-open, net of round-trip costs, and leakage-free
 * as long as the caller stamps each event at the moment it becomes *actionable*
 * (e.g. the close time of the signal bar) and computes features only from data
 * strictly before that moment.
 *
 * Pure and in-memory, deterministic under a fixed seed. This is the
 * statistical core of MidasAI: strategy validation, feature screening and
 * agent-run experiments all reduce to calls into this module.
 */

export type EventDirection = 'LONG' | 'SHORT';

export interface ResearchCandle {
  openTimeMs: number;
  open: number;
}

/** One symbol's price series, indexed for fast forward-return lookup. */
export interface PriceSeries {
  symbol: string;
  /** openTimeMs ascending. */
  times: Float64Array;
  opens: Float64Array;
  /** Median bar spacing (ms); used to reject lookups that land on a data gap. */
  intervalMs: number;
}

/** A single observation: something happened at `timestampMs`, and we bet `direction`. */
export interface ResearchEvent {
  timestampMs: number;
  symbol: string;
  direction: EventDirection;
  /** Feature snapshot captured strictly before `timestampMs`. */
  features: Record<string, number>;
}

export interface Horizon {
  label: string;
  ms: number;
}

export interface EventStudyParams {
  horizons: Horizon[];
  /** Round-trip friction in %, subtracted from every signed return. */
  costPct: number;
  /** Buckets for the feature test. */
  featureBuckets: number;
  permIterations: number;
  permSeed: number;
}

export const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_EVENT_STUDY_PARAMS: EventStudyParams = {
  horizons: [
    { label: '1h', ms: HOUR_MS },
    { label: '4h', ms: 4 * HOUR_MS },
    { label: '24h', ms: 24 * HOUR_MS },
  ],
  costPct: 0.12,
  featureBuckets: 5,
  permIterations: 500,
  permSeed: 1,
};

/* --------------------------------- helpers -------------------------------- */

/** Deterministic PRNG (mulberry32); shared style with trace-engine. */
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

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

function medianDelta(times: Float64Array): number {
  const n = times.length;
  if (n < 2) return HOUR_MS;
  const deltas: number[] = [];
  for (let i = 1; i < n; i += 1) deltas.push(times[i]! - times[i - 1]!);
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)] ?? HOUR_MS;
}

/** First index with times[idx] >= target, or length if none. */
function lowerBound(times: Float64Array, target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Open price at the first bar at/after target, or null if that lands on a gap. */
function priceAtOrAfter(series: PriceSeries, targetMs: number): number | null {
  const idx = lowerBound(series.times, targetMs);
  if (idx >= series.times.length) return null;
  if (series.times[idx]! - targetMs > series.intervalMs * 1.5) return null;
  const price = series.opens[idx]!;
  return price > 0 ? price : null;
}

/* ------------------------------ series + returns --------------------------- */

export function buildPriceSeries(symbol: string, candles: ResearchCandle[]): PriceSeries {
  const sorted = candles.slice().sort((a, b) => a.openTimeMs - b.openTimeMs);
  const n = sorted.length;
  const times = new Float64Array(n);
  const opens = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    times[i] = sorted[i]!.openTimeMs;
    opens[i] = sorted[i]!.open;
  }
  return { symbol, times, opens, intervalMs: medianDelta(times) };
}

/** Signed, cost-adjusted forward return (%) from entryMs over horizonMs; null if unmeasurable. */
export function forwardReturnPct(
  series: PriceSeries,
  entryMs: number,
  horizonMs: number,
  direction: EventDirection,
  costPct: number
): number | null {
  const entry = priceAtOrAfter(series, entryMs);
  const exit = priceAtOrAfter(series, entryMs + horizonMs);
  if (entry === null || exit === null) return null;
  const raw = ((exit - entry) / entry) * 100;
  const signed = direction === 'LONG' ? raw : -raw;
  return signed - costPct;
}

/* --------------------------------- edge test ------------------------------ */

export interface EdgeResult {
  horizonLabel: string;
  n: number;
  meanNetReturnPct: number;
  stdNetReturnPct: number;
  tStat: number;
  /** P(random-timing mean >= observed mean); one-sided, lower = stronger. */
  permPValue: number;
}

interface MeasuredRow {
  event: ResearchEvent;
  ret: number;
}

function tStat(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const s = std(values);
  if (s === 0) return values[0]! > 0 ? Number.POSITIVE_INFINITY : 0;
  return (mean(values) / s) * Math.sqrt(n);
}

/** Sample one random-timing forward return with the given direction, or null. */
function sampleRandomReturn(
  series: PriceSeries,
  direction: EventDirection,
  horizonMs: number,
  costPct: number,
  rand: () => number
): number | null {
  const first = series.times[0]!;
  const last = series.times[series.times.length - 1]!;
  const span = last - horizonMs - first;
  if (span <= 0) return null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const t = first + rand() * span;
    const ret = forwardReturnPct(series, t, horizonMs, direction, costPct);
    if (ret !== null) return ret;
  }
  return null;
}

function edgeTest(
  rows: MeasuredRow[],
  horizon: Horizon,
  seriesBySymbol: Map<string, PriceSeries>,
  params: EventStudyParams,
  rand: () => number
): EdgeResult {
  const returns = rows.map((r) => r.ret);
  const observedMean = mean(returns);

  let ge = 0;
  for (let iter = 0; iter < params.permIterations; iter += 1) {
    const nullReturns: number[] = [];
    for (const row of rows) {
      const series = seriesBySymbol.get(row.event.symbol);
      if (!series) continue;
      const r = sampleRandomReturn(series, row.event.direction, horizon.ms, params.costPct, rand);
      if (r !== null) nullReturns.push(r);
    }
    if (nullReturns.length > 0 && mean(nullReturns) >= observedMean) ge += 1;
  }

  return {
    horizonLabel: horizon.label,
    n: returns.length,
    meanNetReturnPct: observedMean,
    stdNetReturnPct: std(returns),
    tStat: tStat(returns),
    permPValue: params.permIterations > 0 ? ge / params.permIterations : 1,
  };
}

/* ------------------------------- feature test ----------------------------- */

export interface FeatureBucket {
  meanFeature: number;
  meanNetReturnPct: number;
  n: number;
}

export interface FeatureTestResult {
  horizonLabel: string;
  feature: string;
  n: number;
  buckets: FeatureBucket[];
  spreadTopMinusBottom: number;
  spearman: number;
  /** P(|shuffled spread| >= |observed spread|); two-sided, lower = stronger. */
  permPValue: number;
  monotonic: boolean;
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j += 1;
    const avgRank = (i + j) / 2;
    for (let k = i; k <= j; k += 1) out[order[k]!.i] = avgRank;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/** Split indices (sorted by feature) into k contiguous near-equal buckets; return top-minus-bottom mean return. */
function bucketSpread(
  featureValues: number[],
  returns: number[],
  bucketCount: number
): { buckets: FeatureBucket[]; spread: number; monotonic: boolean } {
  const n = featureValues.length;
  const order = featureValues.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const buckets: FeatureBucket[] = [];
  for (let b = 0; b < bucketCount; b += 1) {
    const start = Math.floor((b * n) / bucketCount);
    const end = Math.floor(((b + 1) * n) / bucketCount);
    if (end <= start) continue;
    const feats: number[] = [];
    const rets: number[] = [];
    for (let k = start; k < end; k += 1) {
      const idx = order[k]!.i;
      feats.push(featureValues[idx]!);
      rets.push(returns[idx]!);
    }
    buckets.push({ meanFeature: mean(feats), meanNetReturnPct: mean(rets), n: rets.length });
  }
  const spread =
    buckets.length >= 2 ? buckets[buckets.length - 1]!.meanNetReturnPct - buckets[0]!.meanNetReturnPct : 0;
  let monotonic = buckets.length >= 2;
  for (let b = 1; b < buckets.length; b += 1) {
    if (buckets[b]!.meanNetReturnPct < buckets[b - 1]!.meanNetReturnPct) monotonic = false;
  }
  return { buckets, spread, monotonic };
}

function featureTest(
  rows: MeasuredRow[],
  feature: string,
  horizon: Horizon,
  params: EventStudyParams,
  rand: () => number
): FeatureTestResult | null {
  const withFeature = rows.filter((r) => Number.isFinite(r.event.features[feature]));
  if (withFeature.length < params.featureBuckets * 2) return null;

  const featureValues = withFeature.map((r) => r.event.features[feature]!);
  const returns = withFeature.map((r) => r.ret);

  const { buckets, spread, monotonic } = bucketSpread(featureValues, returns, params.featureBuckets);
  const spearman = pearson(ranks(featureValues), ranks(returns));

  const shuffled = featureValues.slice();
  let ge = 0;
  const absObserved = Math.abs(spread);
  for (let iter = 0; iter < params.permIterations; iter += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    const nullSpread = bucketSpread(shuffled, returns, params.featureBuckets).spread;
    if (Math.abs(nullSpread) >= absObserved) ge += 1;
  }

  return {
    horizonLabel: horizon.label,
    feature,
    n: withFeature.length,
    buckets,
    spreadTopMinusBottom: spread,
    spearman,
    permPValue: params.permIterations > 0 ? ge / params.permIterations : 1,
    monotonic,
  };
}

/* ------------------------- per-event-horizon edge test --------------------- */

export interface HorizonedEvent extends ResearchEvent {
  /** This event's own measurement horizon (exit time − entry time). */
  horizonMs: number;
}

/**
 * Edge test for signal streams whose horizon is PART of the signal
 * (time-window/seasonality strategies): each event is measured over its own
 * horizon, and the null samples random entry TIMES while preserving both the
 * direction mix and the horizon distribution — so neither drift nor
 * horizon-length choices can masquerade as timing skill.
 */
export function runPerEventHorizonEdgeTest(
  seriesBySymbol: Map<string, PriceSeries>,
  events: HorizonedEvent[],
  paramsInput?: Partial<Pick<EventStudyParams, 'costPct' | 'permIterations' | 'permSeed'>>
): EdgeResult & { measured: number } {
  const params = { ...DEFAULT_EVENT_STUDY_PARAMS, ...paramsInput };
  const rand = mulberry32(params.permSeed);

  const measured: Array<{ event: HorizonedEvent; ret: number }> = [];
  for (const event of events) {
    const series = seriesBySymbol.get(event.symbol);
    if (!series) continue;
    const ret = forwardReturnPct(series, event.timestampMs, event.horizonMs, event.direction, params.costPct);
    if (ret !== null) measured.push({ event, ret });
  }
  const returns = measured.map((row) => row.ret);
  const observedMean = mean(returns);

  let ge = 0;
  for (let iter = 0; iter < params.permIterations; iter += 1) {
    const nullReturns: number[] = [];
    for (const row of measured) {
      const series = seriesBySymbol.get(row.event.symbol);
      if (!series) continue;
      const first = series.times[0]!;
      const last = series.times[series.times.length - 1]!;
      const span = last - row.event.horizonMs - first;
      if (span <= 0) continue;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const t = first + rand() * span;
        const ret = forwardReturnPct(series, t, row.event.horizonMs, row.event.direction, params.costPct);
        if (ret !== null) {
          nullReturns.push(ret);
          break;
        }
      }
    }
    if (nullReturns.length > 0 && mean(nullReturns) >= observedMean) ge += 1;
  }

  return {
    horizonLabel: 'per-event',
    n: returns.length,
    meanNetReturnPct: observedMean,
    stdNetReturnPct: std(returns),
    tStat: tStat(returns),
    permPValue: params.permIterations > 0 ? ge / params.permIterations : 1,
    measured: returns.length,
  };
}

/* --------------------------------- top level ------------------------------ */

export interface HorizonReport {
  horizonLabel: string;
  edge: EdgeResult;
  features: FeatureTestResult[];
}

export interface EventStudyReport {
  totalEvents: number;
  measuredByHorizon: Record<string, number>;
  horizons: HorizonReport[];
  params: EventStudyParams;
}

export function runEventStudy(
  seriesBySymbol: Map<string, PriceSeries>,
  events: ResearchEvent[],
  paramsInput?: Partial<EventStudyParams>
): EventStudyReport {
  const params: EventStudyParams = { ...DEFAULT_EVENT_STUDY_PARAMS, ...paramsInput };
  const rand = mulberry32(params.permSeed);

  const featureNames = new Set<string>();
  for (const event of events) {
    for (const key of Object.keys(event.features)) featureNames.add(key);
  }

  const measuredByHorizon: Record<string, number> = {};
  const horizons: HorizonReport[] = params.horizons.map((horizon) => {
    const rows: MeasuredRow[] = [];
    for (const event of events) {
      const series = seriesBySymbol.get(event.symbol);
      if (!series) continue;
      const ret = forwardReturnPct(series, event.timestampMs, horizon.ms, event.direction, params.costPct);
      if (ret !== null) rows.push({ event, ret });
    }
    measuredByHorizon[horizon.label] = rows.length;

    const edge = edgeTest(rows, horizon, seriesBySymbol, params, rand);
    const features: FeatureTestResult[] = [];
    for (const feature of featureNames) {
      const result = featureTest(rows, feature, horizon, params, rand);
      if (result) features.push(result);
    }
    features.sort((a, b) => a.permPValue - b.permPValue);

    return { horizonLabel: horizon.label, edge, features };
  });

  return {
    totalEvents: events.length,
    measuredByHorizon,
    horizons,
    params,
  };
}
