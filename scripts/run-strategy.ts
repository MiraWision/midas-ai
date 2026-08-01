/**
 * Run a registered strategy through the two-stage evaluation on stored candles.
 *
 *   pnpm strategy:run -- --strategy sma-cross --interval 1h
 *   pnpm strategy:run -- --strategy sma-cross --interval 1h --hold-bars 24 \
 *       --cost-pct 0.24 --symbols BTCUSDC,ETHUSDC
 *
 * Stage 1 — event study: are the signals better than random timing, net of
 * costs? (This is the gate. If permP is high here, stage 2 is decoration.)
 * Stage 2 — sandbox simulation: path effects (capital contention, drawdown)
 * under pessimistic fills.
 */

import { and, asc, eq } from 'drizzle-orm';

import type { Candle, CandleInterval } from '../src/core/exchange/types';
import { CANDLE_INTERVAL_MS } from '../src/core/exchange/types';
import {
  buildPriceSeries,
  runEventStudy,
  runPerEventHorizonEdgeTest,
  type HorizonedEvent,
  type ResearchEvent,
} from '../src/core/research/event-study';
import { replaySignals } from '../src/core/strategy/replay';
import { simulateSignals } from '../src/core/strategy/simulate';
import { db } from '../src/db';
import { marketCandles } from '../src/db/schema';
import { universeRepository } from '../src/db/repositories/market';
import { getStrategy } from '../src/strategies';

const ARGV = process.argv.slice(2).filter((token) => token !== '--');
function arg(name: string): string | undefined {
  const idx = ARGV.indexOf(`--${name}`);
  return idx >= 0 ? ARGV[idx + 1] : undefined;
}

const VALID_INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

async function loadCandles(source: string, symbol: string, interval: CandleInterval): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(marketCandles)
    .where(
      and(eq(marketCandles.source, source), eq(marketCandles.symbol, symbol), eq(marketCandles.interval, interval))
    )
    .orderBy(asc(marketCandles.openTimeMs));
  return rows.map((r) => ({ openTimeMs: r.openTimeMs, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}

async function main(): Promise<void> {
  const strategyId = arg('strategy');
  const strategy = strategyId ? getStrategy(strategyId) : undefined;
  if (!strategy) throw new Error(`--strategy <id> required; known: see src/strategies (got "${strategyId ?? ''}")`);

  const interval = (arg('interval') ?? '1h') as CandleInterval;
  if (!VALID_INTERVALS.includes(interval)) throw new Error(`invalid --interval ${interval}`);
  const holdBars = Number(arg('hold-bars') ?? 24);
  const costPct = Number(arg('cost-pct') ?? 0.12);
  const source = arg('source') ?? 'kraken';

  const symbols = arg('symbols')?.split(',').map((s) => s.trim().toUpperCase()) ?? (await universeRepository.listEnabled(source));
  if (symbols.length === 0) throw new Error('no symbols — sync candles first (pnpm market:sync -- --refresh-universe)');

  const candlesBySymbol = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    const candles = await loadCandles(source, symbol, interval);
    if (candles.length > 0) candlesBySymbol.set(symbol, candles);
  }
  const barCounts = [...candlesBySymbol.values()].map((c) => c.length);
  console.log(`[data] ${candlesBySymbol.size} symbols, ${Math.min(...barCounts)}–${Math.max(...barCounts)} ${interval} bars each`);

  // Replay — no lookahead, enforced by slicing.
  const params = strategy.defaultParams;
  const { signals, steps } = replaySignals(strategy, params, candlesBySymbol, {
    interval,
    warmupBars: Math.max(...Object.values(params).map((v) => (typeof v === 'number' ? v : 0)), 0) + 1,
  });
  console.log(`[replay] ${signals.length} signals from ${steps} steps (params ${JSON.stringify(params)})`);
  if (signals.length === 0) {
    console.log('no signals — nothing to evaluate.');
    return;
  }

  // Stage 1 — event study.
  const events: ResearchEvent[] = signals.map((s) => {
    const features: Record<string, number> = {};
    if (typeof s.confidence === 'number') features.confidence = s.confidence;
    return { timestampMs: s.entryMs, symbol: s.symbol, direction: s.direction, features };
  });
  const seriesBySymbol = new Map(
    [...candlesBySymbol.entries()].map(([symbol, candles]) => [symbol, buildPriceSeries(symbol, candles)])
  );
  const horizonMs = holdBars * CANDLE_INTERVAL_MS[interval];
  const report = runEventStudy(seriesBySymbol, events, {
    horizons: [{ label: `${holdBars}bars`, ms: horizonMs }],
    costPct,
  });
  const edge = report.horizons[0]!.edge;
  console.log(`\n[stage 1 — event study] n=${edge.n} meanNet=${edge.meanNetReturnPct.toFixed(3)}% t=${edge.tStat.toFixed(2)} permP=${edge.permPValue.toFixed(3)}`);
  if (edge.permPValue >= 0.05) {
    console.log('  → NOT distinguishable from random timing at p<0.05. Treat stage 2 as descriptive only.');
  }

  // Signals carrying their own horizons get the per-event-horizon edge test —
  // for time-window strategies this is the primary stage-1 number.
  if (signals.some((s) => typeof s.horizonMs === 'number')) {
    const horizoned: HorizonedEvent[] = signals.map((s) => ({
      timestampMs: s.entryMs,
      symbol: s.symbol,
      direction: s.direction,
      features: {},
      horizonMs: s.horizonMs ?? horizonMs,
    }));
    const perEvent = runPerEventHorizonEdgeTest(seriesBySymbol, horizoned, { costPct });
    console.log(
      `[stage 1 — per-event horizons] n=${perEvent.n} meanNet=${perEvent.meanNetReturnPct.toFixed(3)}% t=${perEvent.tStat.toFixed(2)} permP=${perEvent.permPValue.toFixed(3)}`
    );
  }

  // Stage 2 — sandbox simulation.
  const sim = simulateSignals(signals, candlesBySymbol, {
    interval,
    holdBars,
    quotePerTrade: Number(arg('quote-per-trade') ?? 500),
    sandbox: { quote: 'USDC', startingCash: Number(arg('cash') ?? 10_000), feeBps: 26, slippageBps: 5 },
  });
  console.log(
    `\n[stage 2 — simulation] trades=${sim.trades.length} return=${sim.totalReturnPct.toFixed(2)}% maxDD=${sim.maxDrawdownPct.toFixed(2)}%` +
      ` (skipped: ${sim.skippedShorts} shorts, ${sim.skippedNoCash} no-cash)`
  );
  console.log(`final equity: ${sim.finalEquity.toFixed(2)} USDC`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
