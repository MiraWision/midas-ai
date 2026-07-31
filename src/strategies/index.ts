/**
 * The strategy registry — every StrategyModule the app knows about.
 *
 * This is the one place you plug your own strategies in: implement the
 * contract (src/core/strategy/types.ts), put the module in this directory,
 * and add it to the list below. It then shows up on /strategies, can be
 * pinned to the sidebar, and is addressable by every runner.
 */

import type { StrategyModule } from '@/core/strategy/types';
import { smaCross } from './sma-cross';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STRATEGIES: StrategyModule<any>[] = [smaCross];

export function getStrategy(id: string): StrategyModule | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
