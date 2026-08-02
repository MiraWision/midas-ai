/**
 * Pure scaling/geometry helpers for the SVG charts. Kept out of the
 * components so the fiddly parts (nice ticks, NaN-gapped paths) are unit
 * tested instead of eyeballed.
 */

export interface LinearScale {
  min: number;
  max: number;
  toPx: (value: number) => number;
}

/** Linear scale mapping [min,max] → [pxFrom,pxTo] (works inverted for SVG y). */
export function linearScale(min: number, max: number, pxFrom: number, pxTo: number): LinearScale {
  const span = max - min || 1;
  return {
    min,
    max,
    toPx: (value: number) => pxFrom + ((value - min) / span) * (pxTo - pxFrom),
  };
}

/** Round-numbered axis ticks covering [min,max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step / 1e6; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return ticks;
}

/**
 * SVG path for a bar-aligned series, skipping NaN warmups: each finite run
 * becomes its own M…L… segment, so gaps stay visible gaps.
 */
export function seriesPath(values: readonly number[], xAt: (i: number) => number, yAt: (v: number) => number): string {
  let path = '';
  let penDown = false;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    if (!Number.isFinite(value)) {
      penDown = false;
      continue;
    }
    path += `${penDown ? 'L' : 'M'}${xAt(i).toFixed(2)},${yAt(value).toFixed(2)}`;
    penDown = true;
  }
  return path;
}

/** Decimal places that keep tick labels distinct but short. */
export function tickDecimals(step: number): number {
  if (step >= 100) return 0;
  if (step >= 1) return step >= 10 ? 0 : 1;
  return Math.min(8, Math.max(0, -Math.floor(Math.log10(step)) + 1));
}
