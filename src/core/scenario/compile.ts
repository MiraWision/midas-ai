/**
 * Scenario compiler: JSON definition → StrategyModule.
 *
 * Compiled scenarios are indistinguishable from code strategies to the rest
 * of the platform — replay, gates, autopilot and the UI all just see a
 * StrategyModule. Validation is eager: a bad scenario fails at registry load
 * with a message naming the file-level problem, not at 3am inside a tick.
 */

import type { StrategyModule } from '../strategy/types';
import { indicatorCross } from './generators/indicator-cross';
import { seasonalWindows } from './generators/seasonal-windows';
import type { ScenarioDefinition, SignalGenerator } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GENERATORS: SignalGenerator<any>[] = [seasonalWindows, indicatorCross];

export function getGenerator(type: string): SignalGenerator | undefined {
  return GENERATORS.find((generator) => generator.type === type);
}

export function scenarioToStrategy(definition: ScenarioDefinition): StrategyModule {
  if (!definition.id || !/^[a-z0-9-]+$/.test(definition.id)) {
    throw new Error(`scenario: invalid id "${String(definition.id)}" (use kebab-case)`);
  }
  const generator = getGenerator(definition.signal?.type ?? '');
  if (!generator) {
    throw new Error(
      `scenario "${definition.id}": unknown signal type "${definition.signal?.type}" ` +
        `(have: ${GENERATORS.map((g) => g.type).join(', ')})`
    );
  }
  const params = { ...generator.defaultParams, ...(definition.signal.params ?? {}) };

  return {
    id: definition.id,
    name: definition.name || definition.id,
    defaultParams: params,
    analyze(ctx, overrides) {
      if (definition.interval && ctx.interval !== definition.interval) return [];
      return generator.generate(ctx, { ...params, ...overrides });
    },
  };
}
