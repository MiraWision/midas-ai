import { bigint, doublePrecision, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
