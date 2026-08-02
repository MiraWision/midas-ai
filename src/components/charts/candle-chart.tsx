/**
 * Server-rendered SVG candlestick chart with indicator overlays and signal
 * markers. No client JS, no chart library — the platform's charts are plain
 * markup in the mw design, cheap to render anywhere.
 */

import type { Candle } from '@/core/exchange/types';
import { linearScale, niceTicks, seriesPath, tickDecimals } from './scale';

export interface ChartOverlay {
  label: string;
  /** Bar-aligned values (NaN = warmup gap), same length as candles. */
  values: readonly number[];
  color: string;
}

export interface ChartMarker {
  /** Index into the candle array. */
  index: number;
  direction: 'LONG' | 'SHORT';
}

const W = 960;
const H = 420;
const PAD = { left: 64, right: 14, top: 14, bottom: 30 };

export function CandleChart({
  candles,
  overlays = [],
  markers = [],
}: {
  candles: readonly Candle[];
  overlays?: ChartOverlay[];
  markers?: ChartMarker[];
}) {
  if (candles.length === 0) {
    return <p className="mw-empty">No candles for this selection.</p>;
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  let lo = Infinity;
  let hi = -Infinity;
  for (const candle of candles) {
    lo = Math.min(lo, candle.low);
    hi = Math.max(hi, candle.high);
  }
  for (const overlay of overlays) {
    for (const value of overlay.values) {
      if (Number.isFinite(value)) {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
    }
  }
  const pad = (hi - lo) * 0.04 || hi * 0.01 || 1;
  const y = linearScale(lo - pad, hi + pad, PAD.top + plotH, PAD.top);
  const ticks = niceTicks(lo - pad, hi + pad, 5);
  const decimals = tickDecimals(ticks.length > 1 ? ticks[1]! - ticks[0]! : 1);

  const n = candles.length;
  const band = plotW / n;
  const bodyW = Math.max(Math.min(band * 0.62, 11), 1);
  const xCenter = (i: number) => PAD.left + band * (i + 0.5);

  const labelEvery = Math.max(1, Math.round(n / 6));
  const spanMs = candles[n - 1]!.openTimeMs - candles[0]!.openTimeMs;
  const timeLabel = (ms: number) => {
    const d = new Date(ms);
    return spanMs > 72 * 3_600_000
      ? `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mw-chart" role="img" aria-label="candlestick chart">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y.toPx(tick)} y2={y.toPx(tick)} className="mw-chart-grid" />
          <text x={PAD.left - 8} y={y.toPx(tick) + 4} textAnchor="end" className="mw-chart-label">
            {tick.toFixed(decimals)}
          </text>
        </g>
      ))}

      {candles.map((candle, i) => {
        const up = candle.close >= candle.open;
        const cx = xCenter(i);
        const top = y.toPx(Math.max(candle.open, candle.close));
        const bottom = y.toPx(Math.min(candle.open, candle.close));
        return (
          <g key={candle.openTimeMs} className={up ? 'mw-candle-up' : 'mw-candle-down'}>
            <line x1={cx} x2={cx} y1={y.toPx(candle.high)} y2={y.toPx(candle.low)} />
            <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(bottom - top, 1)} />
            {i % labelEvery === 0 && (
              <text x={cx} y={H - 8} textAnchor="middle" className="mw-chart-label">
                {timeLabel(candle.openTimeMs)}
              </text>
            )}
          </g>
        );
      })}

      {overlays.map((overlay) => (
        <path
          key={overlay.label}
          d={seriesPath(overlay.values, xCenter, (v) => y.toPx(v))}
          fill="none"
          stroke={overlay.color}
          strokeWidth={1.6}
          opacity={0.9}
        />
      ))}

      {markers.map((marker, k) => {
        const candle = candles[marker.index];
        if (!candle) return null;
        const cx = xCenter(marker.index);
        const long = marker.direction === 'LONG';
        const tip = long ? y.toPx(candle.low) + 8 : y.toPx(candle.high) - 8;
        const base = long ? tip + 9 : tip - 9;
        return (
          <polygon
            key={`${marker.index}-${k}`}
            points={`${cx},${tip} ${cx - 5},${base} ${cx + 5},${base}`}
            className={long ? 'mw-marker-long' : 'mw-marker-short'}
          />
        );
      })}

      {overlays.length > 0 && (
        <g>
          {overlays.map((overlay, i) => (
            <g key={overlay.label} transform={`translate(${PAD.left + 10 + i * 130}, ${PAD.top + 12})`}>
              <line x1={0} x2={18} y1={-4} y2={-4} stroke={overlay.color} strokeWidth={2} />
              <text x={24} y={0} className="mw-chart-label">
                {overlay.label}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
