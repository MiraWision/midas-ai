/**
 * The scenario registry — no-code strategies assembled from platform blocks.
 *
 * A scenario is a JSON file in this directory (see seasonal-example.json):
 * pick a signal generator, set its params, add one import line below. It
 * then behaves exactly like a code strategy everywhere. PRIVATE scenarios go
 * in src/scenarios/user/ — gitignored by the platform, impossible to commit.
 */

import type { ScenarioDefinition } from '@/core/scenario/types';
import seasonalExample from './seasonal-example.json';

export const SCENARIOS: ScenarioDefinition[] = [seasonalExample as ScenarioDefinition];
