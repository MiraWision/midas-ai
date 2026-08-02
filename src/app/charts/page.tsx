import { CandleChart, type ChartMarker, type ChartOverlay } from '@/components/charts/candle-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { CANDLE_INTERVAL_MS, type CandleInterval } from '@/core/exchange/types';
import { closes, ema as emaCalc, sma as smaCalc } from '@/core/indicators';
import { replaySignals } from '@/core/strategy/replay';
import { loadRecentCandles } from '@/server/chart-data';
import { readDatasetRows } from '@/db/repositories/datasets';
import { universeRepository } from '@/db/repositories/market';
import { DATASETS, getDataset } from '@/datasets';
import { getStrategy, STRATEGIES } from '@/strategies';

export const dynamic = 'force-dynamic';

const OVERLAY_COLORS = ['var(--green)', 'var(--blue)', 'var(--amber)', 'var(--red)'];
const INTERVALS: CandleInterval[] = ['15m', '1h', '4h', '1d'];

interface Search {
  symbol?: string;
  interval?: string;
  bars?: string;
  sma?: string;
  ema?: string;
  strategy?: string;
  dataset?: string;
  key?: string;
  column?: string;
}

function parseWindows(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 1 && n <= 500)
    .slice(0, 3);
}

export default async function ChartsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;

  let symbols: string[] = [];
  let dbError = false;
  try {
    symbols = await universeRepository.listEnabled('kraken');
  } catch {
    dbError = true;
  }

  const symbol = (params.symbol ?? symbols[0] ?? 'BTCUSDC').toUpperCase();
  const interval = (INTERVALS.includes(params.interval as CandleInterval) ? params.interval : '1h') as CandleInterval;
  const bars = Math.min(Math.max(Number(params.bars ?? 336) || 336, 60), 1000);
  const smaWindows = parseWindows(params.sma);
  const emaWindows = parseWindows(params.ema);
  const strategyId = params.strategy && getStrategy(params.strategy) ? params.strategy : '';

  const candles = dbError ? [] : await loadRecentCandles('kraken', symbol, interval, bars);
  const price = closes(candles);

  const overlays: ChartOverlay[] = [];
  for (const window of smaWindows) overlays.push({ label: `SMA ${window}`, values: smaCalc(price, window), color: '' });
  for (const window of emaWindows) overlays.push({ label: `EMA ${window}`, values: emaCalc(price, window), color: '' });
  overlays.forEach((overlay, i) => (overlay.color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]!));

  const markers: ChartMarker[] = [];
  if (strategyId && candles.length > 0) {
    const strategy = getStrategy(strategyId)!;
    const warmup = Math.max(...Object.values(strategy.defaultParams).map((v) => (typeof v === 'number' ? v : 0)), 0) + 1;
    const { signals } = replaySignals(strategy, strategy.defaultParams, new Map([[symbol, candles]]), {
      interval,
      warmupBars: warmup,
    });
    const intervalMs = CANDLE_INTERVAL_MS[interval];
    for (const signal of signals) {
      const index = candles.findIndex((c) => c.openTimeMs >= signal.entryMs - intervalMs);
      if (index >= 0) markers.push({ index, direction: signal.direction });
    }
  }

  // Dataset mode
  const dataset = params.dataset ? getDataset(params.dataset) : undefined;
  let datasetBars: Array<{ label: string; value: number }> = [];
  const datasetKey = params.key?.toUpperCase() ?? symbol;
  const numericColumns = dataset?.columns.filter((c) => c.type === 'number') ?? [];
  const column = numericColumns.find((c) => c.name === params.column)?.name ?? numericColumns[0]?.name;
  if (dataset && column && !dbError) {
    const rows = await readDatasetRows(dataset.id, { key: datasetKey });
    datasetBars = rows.map((row) => ({
      label: String(row.values[dataset.columns[1]?.name ?? 'key'] ?? row.key).slice(0, 10),
      value: Number(row.values[column] ?? 0),
    }));
  }

  return (
    <>
      <h1 className="mw-hero-title">Charts</h1>
      <p className="mw-hero-sub">
        Price with indicator overlays and strategy signals — every backtest visually auditable.
        Server-rendered SVG, no chart library.
      </p>

      <form className="mw-card mw-chart-form" method="GET">
        <label>
          symbol
          <select name="symbol" defaultValue={symbol}>
            {(symbols.length > 0 ? symbols : [symbol]).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          interval
          <select name="interval" defaultValue={interval}>
            {INTERVALS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          bars
          <input name="bars" defaultValue={bars} size={5} />
        </label>
        <label>
          SMA
          <input name="sma" defaultValue={params.sma ?? '12,48'} size={8} placeholder="12,48" />
        </label>
        <label>
          EMA
          <input name="ema" defaultValue={params.ema ?? ''} size={8} placeholder="21" />
        </label>
        <label>
          signals
          <select name="strategy" defaultValue={strategyId}>
            <option value="">none</option>
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="mw-pin-button">
          render
        </button>
      </form>

      <div className="mw-card">
        <div className="mw-card-title">
          {symbol} · {interval} · {candles.length} bars
          {strategyId ? ` · ${markers.length} signals (${strategyId})` : ''}
        </div>
        {dbError ? (
          <p className="mw-empty">
            Database unavailable — <code>docker compose up -d db</code>.
          </p>
        ) : (
          <CandleChart candles={candles} overlays={overlays} markers={markers} />
        )}
      </div>

      <div className="mw-card">
        <div className="mw-card-title">Dataset series</div>
        <form className="mw-chart-form" method="GET" style={{ padding: 0, border: 'none', background: 'none' }}>
          <input type="hidden" name="symbol" value={symbol} />
          <input type="hidden" name="interval" value={interval} />
          <label>
            dataset
            <select name="dataset" defaultValue={dataset?.id ?? ''}>
              <option value="">none</option>
              {DATASETS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            key
            <input name="key" defaultValue={datasetKey} size={10} />
          </label>
          <label>
            column
            <select name="column" defaultValue={column ?? ''}>
              {(numericColumns.length > 0 ? numericColumns : [{ name: 'meanReturnPct' }]).map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="mw-pin-button">
            plot
          </button>
        </form>
        {dataset && datasetBars.length > 0 ? (
          <BarChart data={datasetBars} />
        ) : (
          <p className="mw-empty" style={{ marginTop: 10 }}>
            Pick a dataset (build one first: <code>midas dataset build weekday-profile</code>).
          </p>
        )}
      </div>
    </>
  );
}
