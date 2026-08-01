/**
 * Deep historical backfill from Kraken's public Trades endpoint.
 *
 *   midas backfill --symbol BTCUSDC --from 2024-01-01
 *   midas backfill --from 2024-06-01              # whole enabled universe
 *   midas backfill --symbol ETHUSDC --intervals 15m,1h,4h
 *
 * Honest expectations: Kraken serves ~1000 trades per page at ~1 req/sec.
 * A liquid pair can be millions of trades per year → hours per symbol. The
 * cursor is persisted after every page (backfill_cursors), so Ctrl-C and
 * re-run continues where it left off. Illiquid pairs finish in minutes.
 *
 * Overlap with the regular OHLC sync is safe: inserts are
 * ON CONFLICT DO NOTHING, and where both exist the venue's own OHLC row
 * (already stored) wins over the trade-aggregated one.
 */

import { and, eq } from 'drizzle-orm';

import { KrakenMarketData } from '../src/core/exchange/kraken/market-data';
import { CANDLE_INTERVAL_MS, type CandleInterval } from '../src/core/exchange/types';
import { TradeCandleAggregator } from '../src/core/market/trade-aggregation';
import { candleRepository, universeRepository } from '../src/db/repositories/market';
import { db } from '../src/db';
import { backfillCursors } from '../src/db/schema';

const ARGV = process.argv.slice(2).filter((token) => token !== '--');
function arg(name: string): string | undefined {
  const idx = ARGV.indexOf(`--${name}`);
  return idx >= 0 ? ARGV[idx + 1] : undefined;
}

const PAGE_DELAY_MS = 1_100; // public rate limit: stay boringly under it
const VALID_INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadCursor(
  source: string,
  symbol: string
): Promise<{ cursorNs: string; startNs: string } | null> {
  const rows = await db
    .select({ cursorNs: backfillCursors.cursorNs, startNs: backfillCursors.startNs })
    .from(backfillCursors)
    .where(and(eq(backfillCursors.source, source), eq(backfillCursors.symbol, symbol)))
    .limit(1);
  return rows[0] ?? null;
}

async function saveCursor(source: string, symbol: string, cursorNs: string, startNs: string): Promise<void> {
  await db
    .insert(backfillCursors)
    .values({ source, symbol, cursorNs, startNs, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [backfillCursors.source, backfillCursors.symbol],
      set: { cursorNs, startNs, updatedAt: new Date() },
    });
}

async function backfillSymbol(
  adapter: KrakenMarketData,
  symbol: string,
  fromMs: number,
  intervals: CandleInterval[]
): Promise<void> {
  const saved = await loadCursor(adapter.id, symbol);
  const fromNs = `${fromMs}000000`;
  // Resume only when the saved run already covers the requested start;
  // asking for EARLIER history restarts pagination from the new start.
  // startNs '0' = legacy row with unknown coverage → always restart.
  const canResume = saved !== null && saved.startNs !== '0' && BigInt(fromNs) >= BigInt(saved.startNs);
  let cursorNs = canResume ? saved.cursorNs : fromNs;
  const startNs = canResume ? saved.startNs : fromNs;
  if (canResume) console.log(`[${symbol}] resuming from saved cursor`);
  else if (saved) console.log(`[${symbol}] requested start predates covered range — restarting from ${new Date(fromMs).toISOString().slice(0, 10)}`);

  const aggregators = new Map<CandleInterval, TradeCandleAggregator>(
    intervals.map((interval) => [interval, new TradeCandleAggregator(CANDLE_INTERVAL_MS[interval])])
  );

  let pages = 0;
  let tradesTotal = 0;
  let inserted = 0;
  const startedAt = Date.now();

  for (;;) {
    const { trades, lastNs } = await adapter.fetchTradesPage(symbol, cursorNs);
    pages += 1;
    tradesTotal += trades.length;

    for (const [interval, aggregator] of aggregators) {
      for (const trade of trades) aggregator.add(trade);
      const closed = aggregator.drainClosed();
      if (closed.length > 0) inserted += await candleRepository.insertCandles(adapter.id, symbol, interval, closed);
    }

    const progressed = lastNs !== cursorNs;
    cursorNs = lastNs;
    await saveCursor(adapter.id, symbol, cursorNs, startNs);

    if (pages % 25 === 0 && trades.length > 0) {
      const atDate = new Date(trades[trades.length - 1]!.timeMs).toISOString().slice(0, 10);
      const rate = ((tradesTotal / (Date.now() - startedAt)) * 1000).toFixed(0);
      console.log(`[${symbol}] page ${pages}: at ${atDate}, ${tradesTotal} trades (${rate}/s), +${inserted} candles`);
    }

    // End of history: a short page (or a stuck cursor) means we've caught up
    // to the live edge — the regular sync owns everything from here.
    if (trades.length < 900 || !progressed) break;
    await sleep(PAGE_DELAY_MS);
  }

  // Flush everything closed by the end of the stream; the still-forming
  // bucket at the live edge is intentionally dropped (closed bars only).
  const nowMs = Date.now();
  for (const [interval, aggregator] of aggregators) {
    const tail = aggregator.drainBefore(nowMs - CANDLE_INTERVAL_MS[interval]);
    if (tail.length > 0) inserted += await candleRepository.insertCandles(adapter.id, symbol, interval, tail);
  }

  console.log(`[${symbol}] done: ${pages} pages, ${tradesTotal} trades → +${inserted} candles`);
}

async function main(): Promise<void> {
  const fromArg = arg('from');
  if (!fromArg) throw new Error('--from YYYY-MM-DD is required (how far back to build history)');
  const fromMs = Date.parse(`${fromArg}T00:00:00Z`);
  if (!Number.isFinite(fromMs)) throw new Error(`invalid --from date: ${fromArg}`);

  const intervals = (arg('intervals')?.split(',').map((s) => s.trim()) as CandleInterval[] | undefined) ?? ['15m', '1h'];
  const invalid = intervals.filter((i) => !VALID_INTERVALS.includes(i));
  if (invalid.length > 0) throw new Error(`invalid intervals: ${invalid.join(', ')}`);

  const adapter = new KrakenMarketData();
  const symbols = arg('symbol')
    ? [arg('symbol')!.toUpperCase()]
    : (arg('symbols')?.split(',').map((s) => s.trim().toUpperCase()) ?? (await universeRepository.listEnabled(adapter.id)));
  if (symbols.length === 0) throw new Error('no symbols — sync the universe first (midas sync --refresh-universe)');

  console.log(`[backfill] ${symbols.length} symbol(s) from ${fromArg}, intervals ${intervals.join(',')}`);
  console.log('[backfill] liquid pairs take HOURS (rate-limited pagination); Ctrl-C is safe — cursors persist.');

  for (const symbol of symbols) {
    await backfillSymbol(adapter, symbol, fromMs, intervals);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[backfill] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
