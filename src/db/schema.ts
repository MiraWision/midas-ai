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
 * Autopilot instances: "this strategy with these params paper-trades this
 * account" as configuration. Signals→orders happens in `midas autopilot tick`.
 */
export const autopilotInstances = pgTable('autopilot_instances', {
  id: text('id').primaryKey(),
  strategyId: text('strategy_id').notNull(),
  paramsJson: text('params_json').notNull(),
  /** JSON array of symbols; null = the whole enabled universe. */
  symbolsJson: text('symbols_json'),
  interval: text('interval').notNull(),
  accountId: text('account_id').notNull(),
  quotePerTrade: doublePrecision('quote_per_trade').notNull(),
  fallbackHoldBars: bigint('fallback_hold_bars', { mode: 'number' }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Open/closed autopilot lots — the scheduler's memory of what it holds. */
export const autopilotLots = pgTable(
  'autopilot_lots',
  {
    id: text('id').primaryKey(),
    instanceId: text('instance_id').notNull(),
    symbol: text('symbol').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    exitDueMs: bigint('exit_due_ms', { mode: 'number' }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('autopilot_lots_open_unique').on(table.instanceId, table.symbol, table.openedAt)]
);

/** Build metadata per dataset (the rows live in dataset_rows). */
export const datasetBuilds = pgTable('dataset_builds', {
  datasetId: text('dataset_id').primaryKey(),
  builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  rowCount: bigint('row_count', { mode: 'number' }).notNull(),
  paramsJson: text('params_json').notNull(),
});

/** Materialized dataset rows; a rebuild replaces all rows of its dataset. */
export const datasetRows = pgTable(
  'dataset_rows',
  {
    datasetId: text('dataset_id').notNull(),
    key: text('key').notNull(),
    timestampMs: bigint('timestamp_ms', { mode: 'number' }).notNull(),
    valuesJson: text('values_json').notNull(),
  },
  (table) => [uniqueIndex('dataset_rows_unique').on(table.datasetId, table.key, table.timestampMs)]
);

/**
 * Resumable deep-backfill progress (Kraken Trades pagination). One cursor per
 * (source, symbol); a multi-hour backfill can be interrupted and re-run.
 */
export const backfillCursors = pgTable(
  'backfill_cursors',
  {
    source: text('source').notNull(),
    symbol: text('symbol').notNull(),
    cursorNs: text('cursor_ns').notNull(),
    /** Start of the covered range — a request from EARLIER than this restarts. */
    startNs: text('start_ns').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('backfill_cursors_unique').on(table.source, table.symbol)]
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
