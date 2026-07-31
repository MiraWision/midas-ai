/**
 * Strategy contract.
 *
 * A strategy is a pure module: candles in, signals out. The engine — not the
 * strategy — owns execution, sizing, retraining cadence and safety. Two rules
 * make a strategy testable by the platform's statistics, and both are
 * non-negotiable:
 *
 *   1. NO LOOKAHEAD. `analyze` may only use bars with
 *      `openTimeMs + intervalMs <= ctx.nowMs` (fully closed bars). Signals
 *      stamped in the past are rejected by the engine.
 *   2. DETERMINISM. Same inputs + same params → same signals. Randomness, if
 *      any, must come from a seed inside `params`.
 *
 * Anything that follows this contract can be walk-forward tested, sandboxed,
 * and event-studied without custom glue.
 */

import type { Candle, CandleInterval } from '../exchange/types';

export type SignalDirection = 'LONG' | 'SHORT';

export interface StrategySignal {
  symbol: string;
  direction: SignalDirection;
  /** When the signal becomes actionable. Must be >= ctx.nowMs. */
  entryMs: number;
  /** Optional intended holding period; engines may use it for exits. */
  horizonMs?: number;
  /** Optional 0..1 conviction, used for sizing experiments. */
  confidence?: number;
  /** Free-form diagnostics; never used by the engine for decisions. */
  meta?: Record<string, number | string>;
}

export interface StrategyContext {
  /** Closed candles per symbol, ascending by openTimeMs. */
  candles: ReadonlyMap<string, readonly Candle[]>;
  interval: CandleInterval;
  /** The "now" boundary — see the lookahead rule above. */
  nowMs: number;
}

export interface StrategyModule<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id, e.g. "sma-cross". */
  readonly id: string;
  readonly name: string;
  readonly defaultParams: P;
  /** Pure signal generation under the contract documented above. */
  analyze(ctx: StrategyContext, params: P): StrategySignal[];
}
