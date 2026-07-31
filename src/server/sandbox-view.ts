/**
 * Read-only sandbox view for the UI: accounts, replayed state, and a
 * mark-to-market against the LATEST STORED candle close — not live tickers —
 * so the page renders fast and offline. The "as of" timestamp makes the
 * staleness explicit instead of hiding it.
 */

import { and, desc, eq } from 'drizzle-orm';

import { markToMarket, replayTrades, type PortfolioSnapshot } from '@/core/sandbox/engine';
import { db } from '@/db';
import { marketCandles } from '@/db/schema';
import { listAccounts, loadTrades, type SandboxAccount } from '@/db/repositories/sandbox';
import type { SandboxTrade } from '@/core/sandbox/engine';

export interface SandboxAccountView {
  account: SandboxAccount;
  snapshot: PortfolioSnapshot;
  realizedPnl: number;
  tradeCount: number;
  recentTrades: SandboxTrade[];
  /** Open time of the newest candle used for marking, null if unpriced. */
  markedAsOfMs: number | null;
}

async function latestClose(symbol: string): Promise<{ close: number; openTimeMs: number } | null> {
  const rows = await db
    .select({ close: marketCandles.close, openTimeMs: marketCandles.openTimeMs })
    .from(marketCandles)
    .where(and(eq(marketCandles.symbol, symbol), eq(marketCandles.interval, '1h')))
    .orderBy(desc(marketCandles.openTimeMs))
    .limit(1);
  return rows[0] ?? null;
}

export async function readSandboxAccounts(): Promise<SandboxAccountView[]> {
  const accounts = await listAccounts();
  const views: SandboxAccountView[] = [];

  for (const account of accounts) {
    const trades = await loadTrades(account.id);
    const state = replayTrades(account, trades);

    const prices = new Map<string, number>();
    let markedAsOfMs: number | null = null;
    for (const symbol of state.positions.keys()) {
      const row = await latestClose(symbol);
      if (row) {
        prices.set(symbol, row.close);
        markedAsOfMs = Math.max(markedAsOfMs ?? 0, row.openTimeMs);
      }
    }

    views.push({
      account,
      snapshot: markToMarket(state, prices),
      realizedPnl: trades.reduce((sum, t) => sum + t.realizedPnl, 0),
      tradeCount: trades.length,
      recentTrades: trades.slice(-15).reverse(),
      markedAsOfMs,
    });
  }
  return views;
}
