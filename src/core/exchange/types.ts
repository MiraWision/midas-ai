/**
 * Exchange contracts.
 *
 * Market data and trading are deliberately SEPARATE interfaces: the platform
 * is sandbox-first, and most of it runs on public market data alone. A venue
 * integration starts (and can honestly stop) at `MarketDataAdapter`;
 * `TradingAdapter` is the explicit, opt-in surface for live execution.
 */

export interface Candle {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export const CANDLE_INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export interface MarketRef {
  /** Venue-agnostic symbol used across the platform, e.g. "BTCUSDC". */
  symbol: string;
  base: string;
  quote: string;
  /** The venue's own identifier for this market (pair name, product id, …). */
  venueSymbol: string;
}

export interface Ticker {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  timestampMs: number;
}

export interface FetchCandlesOptions {
  /** Earliest open time to include. Venues cap lookback (see adapter docs). */
  sinceMs?: number;
  limit?: number;
}

/** Read-only market data. No keys required for public venues. */
export interface MarketDataAdapter {
  /** Stable adapter id, e.g. "kraken". */
  readonly id: string;
  listMarkets(quote?: string): Promise<MarketRef[]>;
  fetchCandles(symbol: string, interval: CandleInterval, opts?: FetchCandlesOptions): Promise<Candle[]>;
  fetchTicker(symbol: string): Promise<Ticker>;
}

/* ------------------------------ trading (opt-in) --------------------------- */

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  /** Refuse to increase exposure; safety default for closing logic. */
  reduceOnly?: boolean;
}

export interface OrderResult {
  venueOrderId: string;
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED';
  filledQuantity: number;
  avgFillPrice: number | null;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

/**
 * Live execution surface. Implementations MUST work with API keys that lack
 * withdrawal permission — nothing in this platform ever needs to move funds
 * off an exchange, and no implementation may ask for that right.
 */
export interface TradingAdapter {
  readonly id: string;
  placeOrder(request: OrderRequest): Promise<OrderResult>;
  cancelOrder(symbol: string, venueOrderId: string): Promise<void>;
  fetchBalances(): Promise<Balance[]>;
}
