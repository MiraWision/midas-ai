/**
 * The dataset registry — every DatasetDefinition the platform knows about.
 *
 * Like src/strategies/, this directory is USER-OWNED: add your own derived
 * tables here (seasonal profiles, regime labels, anything your research
 * keeps re-deriving) and `midas update` will never overwrite them.
 */

import type { DatasetDefinition } from '@/core/datasets/types';
import { weekdayProfile } from './weekday-profile';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DATASETS: DatasetDefinition<any>[] = [weekdayProfile];

export function getDataset(id: string): DatasetDefinition | undefined {
  return DATASETS.find((d) => d.id === id);
}
