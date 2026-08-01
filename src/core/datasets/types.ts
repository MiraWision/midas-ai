/**
 * Datasets — user-defined derived tables.
 *
 * A dataset is a declared schema plus a builder that computes rows from
 * market data (seasonal profiles, regime labels, liquidity snapshots — any
 * table your research keeps re-deriving). Built rows are materialized into
 * Postgres and readable by strategies, research scripts, and the UI.
 *
 * The builder receives a DatasetContext instead of touching the database —
 * that keeps builders pure with respect to their inputs, unit-testable with
 * fake contexts, and honest: a builder sees candles, not the world.
 */

import type { Candle, CandleInterval } from '../exchange/types';

export type DatasetValue = number | string;

export interface DatasetColumn {
  name: string;
  type: 'number' | 'string';
  description?: string;
}

export interface DatasetRow {
  /** Grouping key, e.g. a symbol or "BTCUSDC:monday". */
  key: string;
  /** Time anchor of the row (bucket start, observation time, …). */
  timestampMs: number;
  values: Record<string, DatasetValue>;
}

export interface DatasetContext {
  /** Symbols currently enabled in the tracked universe. */
  symbols(): Promise<string[]>;
  /** Stored closed candles, ascending; empty array when none. */
  candles(symbol: string, interval: CandleInterval): Promise<Candle[]>;
  /** "Now" for the build — injected so builds are reproducible in tests. */
  nowMs: number;
}

export interface DatasetDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id, e.g. "weekday-profile". */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly columns: DatasetColumn[];
  readonly defaultParams: P;
  /** Compute the full table. Deterministic for a given context + params. */
  build(ctx: DatasetContext, params: P): Promise<DatasetRow[]>;
}
