import { bigint, boolean, doublePrecision, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Closed OHLCV candles, the platform's single source of price truth.
 * `source` is the market-data adapter id (e.g. "kraken") — symbols from
 * different venues never collide because research always filters by source.
 */
export const marketCandles = pgTable(
  'market_candles',
  {
    source: text('source').notNull(),
    symbol: text('symbol').notNull(),
    interval: text('interval').notNull(),
    openTimeMs: bigint('open_time_ms', { mode: 'number' }).notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull(),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('market_candles_unique').on(table.source, table.symbol, table.interval, table.openTimeMs),
  ]
);

/**
 * Sandbox accounts. State (cash, positions) is never stored — it is replayed
 * from sandbox_trades, which is the single source of truth (see
 * src/core/sandbox/engine.ts).
 */
export const sandboxAccounts = pgTable('sandbox_accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  quote: text('quote').notNull(),
  startingCash: doublePrecision('starting_cash').notNull(),
  feeBps: doublePrecision('fee_bps').notNull(),
  slippageBps: doublePrecision('slippage_bps').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only trade log per sandbox account. */
export const sandboxTrades = pgTable(
  'sandbox_trades',
  {
    accountId: text('account_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    timestampMs: bigint('timestamp_ms', { mode: 'number' }).notNull(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    fillPrice: doublePrecision('fill_price').notNull(),
    fee: doublePrecision('fee').notNull(),
    realizedPnl: doublePrecision('realized_pnl').notNull(),
  },
  (table) => [uniqueIndex('sandbox_trades_unique').on(table.accountId, table.seq)]
);

/**
 * The tracked universe. Universe refreshes only ADD rows; `enabled` is the
 * operator's switch and is never flipped back on by automation.
 */
export const trackedMarkets = pgTable(
  'tracked_markets',
  {
    source: text('source').notNull(),
    symbol: text('symbol').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tracked_markets_unique').on(table.source, table.symbol)]
);
