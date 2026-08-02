/**
 * Server-rendered categorical bar chart (dataset columns, PnL breakdowns).
 * Bars grow from a zero baseline; sign decides the tone.
 */

import { linearScale, niceTicks, tickDecimals } from './scale';

export interface BarDatum {
  label: string;
  value: number;
}

const W = 960;
const H = 260;
const PAD = { left: 64, right: 14, top: 14, bottom: 30 };

export function BarChart({ data, unit = '' }: { data: BarDatum[]; unit?: string }) {
  if (data.length === 0) return <p className="mw-empty">No rows to plot.</p>;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const lo = Math.min(0, ...data.map((d) => d.value));
  const hi = Math.max(0, ...data.map((d) => d.value));
  const pad = (hi - lo) * 0.08 || 1;
  const y = linearScale(lo - pad, hi + pad, PAD.top + plotH, PAD.top);
  const ticks = niceTicks(lo - pad, hi + pad, 4);
  const decimals = tickDecimals(ticks.length > 1 ? ticks[1]! - ticks[0]! : 1);

  const band = plotW / data.length;
  const barW = Math.max(Math.min(band * 0.55, 64), 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mw-chart" role="img" aria-label="bar chart">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y.toPx(tick)} y2={y.toPx(tick)} className="mw-chart-grid" />
          <text x={PAD.left - 8} y={y.toPx(tick) + 4} textAnchor="end" className="mw-chart-label">
            {tick.toFixed(decimals)}
            {unit}
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={W - PAD.right} y1={y.toPx(0)} y2={y.toPx(0)} className="mw-chart-zero" />

      {data.map((datum, i) => {
        const cx = PAD.left + band * (i + 0.5);
        const zero = y.toPx(0);
        const top = y.toPx(Math.max(datum.value, 0));
        const bottom = y.toPx(Math.min(datum.value, 0));
        return (
          <g key={datum.label}>
            <rect
              x={cx - barW / 2}
              y={top}
              width={barW}
              height={Math.max(bottom - top, 1)}
              className={datum.value >= 0 ? 'mw-bar-pos' : 'mw-bar-neg'}
            />
            <text x={cx} y={H - 8} textAnchor="middle" className="mw-chart-label">
              {datum.label}
            </text>
            <text
              x={cx}
              y={datum.value >= 0 ? top - 5 : bottom + 13}
              textAnchor="middle"
              className="mw-chart-label"
            >
              {datum.value.toFixed(decimals)}
            </text>
            {/* keep zero line above bars visually */}
            <line x1={cx - barW / 2} x2={cx + barW / 2} y1={zero} y2={zero} className="mw-chart-zero" />
          </g>
        );
      })}
    </svg>
  );
}
