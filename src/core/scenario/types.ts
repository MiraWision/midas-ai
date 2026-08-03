/**
 * No-code scenarios — strategies assembled from platform blocks.
 *
 * A scenario is a JSON document: it names a registered SIGNAL GENERATOR (a
 * platform block) and parameterizes it. The compiler turns the document into
 * a full StrategyModule, so scenarios flow through everything code
 * strategies do — replay, the two-stage gates, autopilot, the UI — with zero
 * custom code. When an idea needs mechanics no generator covers, the answer
 * is a NEW GENERATOR in core (a reusable block with tests), never a one-off
 * module.
 */

import type { CandleInterval } from '../exchange/types';
import type { StrategyContext, StrategySignal } from '../strategy/types';

export interface ScenarioDefinition {
  /** Stable id — becomes the strategy id. */
  id: string;
  name: string;
  signal: {
    /** A generator registered in core/scenario/generators. */
    type: string;
    /** Generator-specific parameters; validated by the generator. */
    params?: Record<string, unknown>;
  };
  /** Optional interval guard: the scenario only runs on this interval. */
  interval?: CandleInterval;
}

export interface SignalGenerator<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly defaultParams: P;
  /** Same purity rules as StrategyModule.analyze — closed bars, deterministic. */
  generate(ctx: StrategyContext, params: P): StrategySignal[];
}
