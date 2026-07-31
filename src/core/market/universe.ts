/**
 * Universe selection — which markets the platform tracks.
 *
 * Selection is a pure ranking over venue stats so it can be tested without a
 * network. The persistence side deliberately only ADDS symbols: an operator's
 * manual disable always survives a refresh (see UniverseRepository.addMissing).
 */

import type { MarketRef } from '../exchange/types';

export interface Market24hStats {
  quoteVolume24h: number;
  lastPrice: number;
}

export interface UniverseSelection {
  symbols: string[];
  /** Symbols that passed the quote filter but were cut by `top`. */
  excludedByRank: string[];
}

export interface SelectUniverseOptions {
  /** Keep only markets quoted in this asset, e.g. "USDC". */
  quote: string;
  /** Keep the N largest by 24h quote volume. */
  top: number;
  /** Drop markets below this 24h quote volume (same unit as the quote asset). */
  minQuoteVolume24h?: number;
}

export function selectUniverse(
  markets: MarketRef[],
  statsBySymbol: ReadonlyMap<string, Market24hStats>,
  options: SelectUniverseOptions
): UniverseSelection {
  const minVolume = options.minQuoteVolume24h ?? 0;

  const eligible = markets
    .filter((m) => m.quote === options.quote)
    .map((m) => ({ symbol: m.symbol, stats: statsBySymbol.get(m.symbol) }))
    .filter((row): row is { symbol: string; stats: Market24hStats } => {
      if (!row.stats) return false;
      return row.stats.quoteVolume24h >= minVolume && row.stats.lastPrice > 0;
    })
    .sort((a, b) => b.stats.quoteVolume24h - a.stats.quoteVolume24h || a.symbol.localeCompare(b.symbol));

  const kept = eligible.slice(0, options.top);
  const cut = eligible.slice(options.top);

  return {
    symbols: kept.map((r) => r.symbol).sort(),
    excludedByRank: cut.map((r) => r.symbol).sort(),
  };
}
