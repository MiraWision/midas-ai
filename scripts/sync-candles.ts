/**
 * Sync closed candles for the tracked universe into Postgres.
 *
 * Usage:
 *   pnpm market:sync                          # sync enabled universe, 15m + 1h
 *   pnpm market:sync -- --intervals 1h        # pick intervals
 *   pnpm market:sync -- --refresh-universe    # add new top markets first
 *   pnpm market:sync -- --top 30 --min-volume 100000 --quote USDC
 *
 * Run it on a schedule (cron/launchd). Venues serve a limited recent window
 * (Kraken: ~720 candles per interval), so history accumulates forward — the
 * sooner this runs regularly, the deeper your research window gets.
 */

import { KrakenMarketData } from '../src/core/exchange/kraken/market-data';
import type { CandleInterval } from '../src/core/exchange/types';
import { syncCandles } from '../src/core/market/candle-sync';
import { selectUniverse } from '../src/core/market/universe';
import { candleRepository, universeRepository } from '../src/db/repositories/market';

interface CliArgs {
  intervals: CandleInterval[];
  refreshUniverse: boolean;
  top: number;
  minVolume: number;
  quote: string;
}

const VALID_INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { intervals: ['15m', '1h'], refreshUniverse: false, top: 30, minVolume: 50_000, quote: 'USDC' };
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === '--intervals' && next) {
      const parsed = next.split(',').map((s) => s.trim()) as CandleInterval[];
      const invalid = parsed.filter((p) => !VALID_INTERVALS.includes(p));
      if (invalid.length > 0) throw new Error(`Invalid intervals: ${invalid.join(', ')}`);
      args.intervals = parsed;
      i += 1;
    } else if (argv[i] === '--top' && next) {
      args.top = Math.max(1, Number(next) || args.top);
      i += 1;
    } else if (argv[i] === '--min-volume' && next) {
      args.minVolume = Math.max(0, Number(next) || args.minVolume);
      i += 1;
    } else if (argv[i] === '--quote' && next) {
      args.quote = next.toUpperCase();
      i += 1;
    } else if (argv[i] === '--refresh-universe') {
      args.refreshUniverse = true;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const adapter = new KrakenMarketData();

  let symbols = await universeRepository.listEnabled(adapter.id);

  if (args.refreshUniverse || symbols.length === 0) {
    const [markets, stats] = await Promise.all([adapter.listMarkets(args.quote), adapter.fetch24hStats(args.quote)]);
    const selection = selectUniverse(markets, stats, {
      quote: args.quote,
      top: args.top,
      minQuoteVolume24h: args.minVolume,
    });
    const added = await universeRepository.addMissing(adapter.id, selection.symbols);
    console.log(
      `[universe] ${selection.symbols.length} markets selected (top ${args.top} by 24h ${args.quote} volume ≥ ${args.minVolume}), ${added} newly tracked`
    );
    symbols = await universeRepository.listEnabled(adapter.id);
  }

  if (symbols.length === 0) {
    console.log('[sync] universe is empty — run with --refresh-universe first.');
    return;
  }

  console.log(`[sync] ${symbols.length} symbols × ${args.intervals.join(', ')}`);
  const reports = await syncCandles(adapter, candleRepository, symbols, { intervals: args.intervals });

  let inserted = 0;
  let failed = 0;
  for (const report of reports) {
    inserted += report.inserted;
    if (report.error) {
      failed += 1;
      console.error(`  ✗ ${report.symbol} ${report.interval}: ${report.error}`);
    }
  }
  console.log(`[sync] done: +${inserted} candles, ${failed} failures across ${reports.length} symbol×interval keys`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[sync] failed:', error);
  process.exit(1);
});
