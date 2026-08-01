/**
 * Kraken spot market data (public REST, no API keys).
 *
 * Venue caveats a consumer must know:
 * - `/0/public/OHLC` returns AT MOST the 720 most recent candles per interval
 *   (≈7.5 days of 15m, 30 days of 1h). Deep historical backfill is NOT
 *   possible via OHLC — accumulate candles with a scheduled sync, or build
 *   them from the paginated `Trades` endpoint / Kraken's official CSV dumps.
 * - Kraken reports times in seconds (converted to UTC ms here) and uses
 *   legacy asset codes in some responses (XBT for BTC, XDG for DOGE).
 */

import {
  CANDLE_INTERVAL_MS,
  type Candle,
  type CandleInterval,
  type FetchCandlesOptions,
  type MarketDataAdapter,
  type MarketRef,
  type Ticker,
} from '../types';

const DEFAULT_API_BASE = 'https://api.kraken.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 400;

export const KRAKEN_OHLC_MAX_PER_REQUEST = 720;

const INTERVAL_MINUTES: Record<CandleInterval, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

/** Kraken legacy asset codes → canonical. */
const ASSET_ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function normalizeAsset(code: string): string {
  return ASSET_ALIASES[code] ?? code;
}

/** "XBT/USDC" → { base: "BTC", quote: "USDC", symbol: "BTCUSDC" } */
function marketFromWsname(wsname: string, venueSymbol: string): MarketRef | null {
  const [rawBase, rawQuote] = wsname.split('/');
  if (!rawBase || !rawQuote) return null;
  const base = normalizeAsset(rawBase);
  const quote = normalizeAsset(rawQuote);
  return { symbol: `${base}${quote}`, base, quote, venueSymbol };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Kraken signals rate limits and maintenance via the `error` array on HTTP 200. */
function isRetryableKrakenError(errors: string[]): boolean {
  return errors.some(
    (e) =>
      e.startsWith('EAPI:Rate limit') ||
      e.startsWith('EGeneral:Too many requests') ||
      e.startsWith('EGeneral:Temporary lockout') ||
      e.startsWith('EService:')
  );
}

interface KrakenEnvelope {
  error?: string[];
  result?: unknown;
}

export class KrakenMarketData implements MarketDataAdapter {
  readonly id = 'kraken';

  private readonly apiBase: string;
  private marketsBySymbol: Map<string, MarketRef> | null = null;

  constructor(options?: { apiBase?: string }) {
    this.apiBase = (options?.apiBase ?? process.env.KRAKEN_MARKET_DATA_API_BASE ?? DEFAULT_API_BASE).replace(
      /\/+$/,
      ''
    );
  }

  async listMarkets(quote?: string): Promise<MarketRef[]> {
    const result = await this.fetchJson('/0/public/AssetPairs');
    const markets: MarketRef[] = [];
    for (const [venueSymbol, info] of Object.entries(asRecord(result) ?? {})) {
      const row = asRecord(info);
      if (!row) continue;
      if (row.status && row.status !== 'online') continue;
      const wsname = typeof row.wsname === 'string' ? row.wsname : null;
      if (!wsname) continue;
      const market = marketFromWsname(wsname, venueSymbol);
      if (!market) continue;
      if (quote && market.quote !== quote) continue;
      markets.push(market);
    }
    markets.sort((a, b) => a.symbol.localeCompare(b.symbol));
    this.marketsBySymbol = new Map(markets.map((m) => [m.symbol, m]));
    return markets;
  }

  async fetchCandles(symbol: string, interval: CandleInterval, opts?: FetchCandlesOptions): Promise<Candle[]> {
    const market = await this.resolveMarket(symbol);
    const params: Record<string, string> = {
      pair: market.venueSymbol,
      interval: String(INTERVAL_MINUTES[interval]),
    };
    if (opts?.sinceMs !== undefined) params.since = String(Math.floor(opts.sinceMs / 1000));

    const result = asRecord(await this.fetchJson('/0/public/OHLC', params));
    if (!result) throw new Error(`Kraken OHLC: empty result for ${symbol}`);
    const rows = Object.entries(result).find(([key]) => key !== 'last')?.[1];
    if (!Array.isArray(rows)) throw new Error(`Kraken OHLC: no rows for ${symbol}`);

    const intervalMs = CANDLE_INTERVAL_MS[interval];
    const candles: Candle[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 7) continue;
      const [t, o, h, l, c, , v] = row as [number, string, string, string, string, string, string];
      const candle: Candle = {
        openTimeMs: t * 1000,
        open: Number.parseFloat(o),
        high: Number.parseFloat(h),
        low: Number.parseFloat(l),
        close: Number.parseFloat(c),
        volume: Number.parseFloat(v),
      };
      if (!Number.isFinite(candle.open) || !Number.isFinite(candle.close)) continue;
      // Kraken includes the still-forming candle as the last row — drop it so
      // consumers only ever see closed bars (the lookahead-safety contract).
      if (candle.openTimeMs + intervalMs > Date.now()) continue;
      candles.push(candle);
    }
    const since = opts?.sinceMs;
    const filtered = since === undefined ? candles : candles.filter((c) => c.openTimeMs >= since);
    return opts?.limit !== undefined ? filtered.slice(-opts.limit) : filtered;
  }

  async fetchTicker(symbol: string): Promise<Ticker> {
    const market = await this.resolveMarket(symbol);
    const result = asRecord(await this.fetchJson('/0/public/Ticker', { pair: market.venueSymbol }));
    const row = asRecord(result ? Object.values(result)[0] : null);
    if (!row) throw new Error(`Kraken Ticker: empty result for ${symbol}`);
    const first = (v: unknown): number => {
      const s = Array.isArray(v) ? v[0] : v;
      const n = typeof s === 'string' ? Number.parseFloat(s) : NaN;
      return Number.isFinite(n) ? n : 0;
    };
    return {
      symbol,
      last: first(row.c),
      bid: first(row.b),
      ask: first(row.a),
      timestampMs: Date.now(),
    };
  }

  /**
   * 24h stats for every listed market in one call (used for universe
   * selection). Quote volume is approximated as base volume × 24h VWAP —
   * Kraken's ticker reports base volume only.
   */
  async fetch24hStats(quote?: string): Promise<Map<string, { quoteVolume24h: number; lastPrice: number }>> {
    if (!this.marketsBySymbol) await this.listMarkets();
    const byVenueSymbol = new Map<string, MarketRef>();
    for (const market of this.marketsBySymbol?.values() ?? []) {
      byVenueSymbol.set(market.venueSymbol, market);
    }

    const result = asRecord(await this.fetchJson('/0/public/Ticker'));
    const stats = new Map<string, { quoteVolume24h: number; lastPrice: number }>();
    for (const [venueSymbol, row] of Object.entries(result ?? {})) {
      const market = byVenueSymbol.get(venueSymbol);
      if (!market) continue;
      if (quote && market.quote !== quote) continue;
      const data = asRecord(row);
      if (!data) continue;
      const baseVolume24h = parseTickerNumber(data.v, 1);
      const vwap24h = parseTickerNumber(data.p, 1);
      const lastPrice = parseTickerNumber(data.c, 0);
      if (!Number.isFinite(baseVolume24h) || !Number.isFinite(vwap24h)) continue;
      stats.set(market.symbol, {
        quoteVolume24h: baseVolume24h * vwap24h,
        lastPrice: Number.isFinite(lastPrice) ? lastPrice : 0,
      });
    }
    return stats;
  }

  /**
   * One page of raw trade history (max ~1000 rows), ascending. `sinceNs` is
   * Kraken's nanosecond cursor; pass the returned `lastNs` to continue.
   * This is the deep-backfill primitive — OHLC caps at ~720 candles, trades
   * go back years.
   */
  async fetchTradesPage(
    symbol: string,
    sinceNs: string
  ): Promise<{ trades: Array<{ timeMs: number; price: number; volume: number }>; lastNs: string }> {
    const market = await this.resolveMarket(symbol);
    const result = asRecord(await this.fetchJson('/0/public/Trades', { pair: market.venueSymbol, since: sinceNs }));
    if (!result) throw new Error(`Kraken Trades: empty result for ${symbol}`);
    const lastNs = typeof result.last === 'string' ? result.last : sinceNs;
    const rows = Object.entries(result).find(([key]) => key !== 'last')?.[1];
    const trades: Array<{ timeMs: number; price: number; volume: number }> = [];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 3) continue;
        const price = Number.parseFloat(String(row[0]));
        const volume = Number.parseFloat(String(row[1]));
        const timeMs = Number(row[2]) * 1000;
        if (Number.isFinite(price) && Number.isFinite(volume) && Number.isFinite(timeMs)) {
          trades.push({ timeMs, price, volume });
        }
      }
    }
    return { trades, lastNs };
  }

  private async resolveMarket(symbol: string): Promise<MarketRef> {
    if (!this.marketsBySymbol) await this.listMarkets();
    const market = this.marketsBySymbol?.get(symbol);
    if (!market) throw new Error(`Unknown Kraken market for symbol "${symbol}"`);
    return market;
  }

  private async fetchJson(path: string, searchParams?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [k, v] of Object.entries(searchParams ?? {})) url.searchParams.set(k, v);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const err = new Error(`Kraken HTTP ${response.status}: ${response.statusText}`);
          if (isRetryableStatus(response.status) && attempt < MAX_RETRIES - 1) {
            lastError = err;
            await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
            continue;
          }
          throw err;
        }

        const body = (await response.json()) as KrakenEnvelope;
        const errors = Array.isArray(body.error) ? body.error : [];
        if (errors.length > 0) {
          const err = new Error(`Kraken API error: ${errors.join('; ')}`);
          if (isRetryableKrakenError(errors) && attempt < MAX_RETRIES - 1) {
            lastError = err;
            await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
            continue;
          }
          throw err;
        }
        if (body.result === undefined) throw new Error('Kraken API returned an empty result');
        return body.result;
      } catch (e) {
        clearTimeout(timeoutId);
        const err = e instanceof Error ? e : new Error('Unknown fetch error');
        lastError = err.name === 'AbortError' ? new Error('Kraken request timed out') : err;
        if (err.message.startsWith('Kraken API error') || err.message.startsWith('Kraken HTTP')) throw err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
      }
    }
    throw lastError ?? new Error('Kraken request failed');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Kraken ticker fields are arrays of strings, e.g. v = [volToday, vol24h]. */
function parseTickerNumber(value: unknown, index: number): number {
  const raw = Array.isArray(value) ? value[index] : value;
  return typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
}
