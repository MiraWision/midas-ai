/**
 * Sandbox engine — paper trading as a pure, replayable state machine.
 *
 * Design rules:
 * - The TRADE LOG is the source of truth. Account state (cash, positions) is
 *   always reconstructable by folding `executeOrder` over the log — there is
 *   no separately-mutated balance to drift out of sync, and every equity
 *   number is auditable from first principles.
 * - Fills are pessimistic: slippage moves the price against you on both
 *   sides, fees are charged on notional. Paper results are only meaningful
 *   if they're harder to achieve than real ones, not easier.
 * - v1 is long-only spot. Shorting spot requires margin mechanics (borrow
 *   costs, liquidation) that deserve their own honest model, not a sign flip.
 *
 * Pure and deterministic: no clock reads, no I/O — callers stamp timestamps.
 */

export interface SandboxConfig {
  /** Quote asset all cash is denominated in, e.g. "USDC". */
  quote: string;
  startingCash: number;
  /** Taker fee per side, in basis points (e.g. 26 = 0.26%). */
  feeBps: number;
  /** Adverse price movement applied to every fill, in basis points. */
  slippageBps: number;
}

export interface SandboxPosition {
  symbol: string;
  quantity: number;
  /** Volume-weighted average fill price of the open quantity. */
  avgEntryPrice: number;
}

export type SandboxSide = 'BUY' | 'SELL';

export interface SandboxOrder {
  timestampMs: number;
  symbol: string;
  side: SandboxSide;
  /** Base-asset quantity. */
  quantity: number;
  /** Reference market price at order time; the engine applies slippage. */
  price: number;
}

export interface SandboxTrade {
  timestampMs: number;
  symbol: string;
  side: SandboxSide;
  quantity: number;
  /** Price actually filled at, slippage included. */
  fillPrice: number;
  fee: number;
  /**
   * PnL realized by this trade net of its own fee (SELL only; 0 for BUY —
   * the entry fee is charged to cash at buy time, not deferred).
   */
  realizedPnl: number;
}

export interface SandboxState {
  cash: number;
  positions: ReadonlyMap<string, SandboxPosition>;
}

/** Quantities smaller than this are treated as fully closed. */
const QUANTITY_EPSILON = 1e-12;

export class SandboxOrderError extends Error {}

export function createSandboxState(config: SandboxConfig): SandboxState {
  if (config.startingCash <= 0) throw new SandboxOrderError('startingCash must be positive');
  return { cash: config.startingCash, positions: new Map() };
}

/** Apply one order; returns the new state and the resulting trade. Throws on invalid orders. */
export function executeOrder(
  state: SandboxState,
  config: SandboxConfig,
  order: SandboxOrder
): { state: SandboxState; trade: SandboxTrade } {
  if (!(order.quantity > 0)) throw new SandboxOrderError('quantity must be positive');
  if (!(order.price > 0)) throw new SandboxOrderError('price must be positive');

  const slip = config.slippageBps / 10_000;
  const feeRate = config.feeBps / 10_000;
  const positions = new Map(state.positions);
  const existing = positions.get(order.symbol);

  if (order.side === 'BUY') {
    const fillPrice = order.price * (1 + slip);
    const notional = order.quantity * fillPrice;
    const fee = notional * feeRate;
    const totalCost = notional + fee;
    if (totalCost > state.cash + QUANTITY_EPSILON) {
      throw new SandboxOrderError(
        `insufficient cash: need ${totalCost.toFixed(2)} ${config.quote}, have ${state.cash.toFixed(2)}`
      );
    }
    const prevQty = existing?.quantity ?? 0;
    const prevAvg = existing?.avgEntryPrice ?? 0;
    const newQty = prevQty + order.quantity;
    positions.set(order.symbol, {
      symbol: order.symbol,
      quantity: newQty,
      avgEntryPrice: (prevQty * prevAvg + order.quantity * fillPrice) / newQty,
    });
    return {
      state: { cash: state.cash - totalCost, positions },
      trade: { ...pick(order), fillPrice, fee, realizedPnl: 0 },
    };
  }

  // SELL
  if (!existing || existing.quantity + QUANTITY_EPSILON < order.quantity) {
    throw new SandboxOrderError(
      `cannot sell ${order.quantity} ${order.symbol}: position is ${existing?.quantity ?? 0} (long-only sandbox)`
    );
  }
  const fillPrice = order.price * (1 - slip);
  const proceeds = order.quantity * fillPrice;
  const fee = proceeds * feeRate;
  const realizedPnl = (fillPrice - existing.avgEntryPrice) * order.quantity - fee;

  const remaining = existing.quantity - order.quantity;
  if (remaining <= QUANTITY_EPSILON) {
    positions.delete(order.symbol);
  } else {
    positions.set(order.symbol, { ...existing, quantity: remaining });
  }
  return {
    state: { cash: state.cash + proceeds - fee, positions },
    trade: { ...pick(order), fillPrice, fee, realizedPnl },
  };
}

function pick(order: SandboxOrder): Pick<SandboxTrade, 'timestampMs' | 'symbol' | 'side' | 'quantity'> {
  return { timestampMs: order.timestampMs, symbol: order.symbol, side: order.side, quantity: order.quantity };
}

/**
 * Rebuild state by replaying the trade log. Trades carry their FILL price, so
 * the replay applies them without re-adding slippage (fee is recomputed from
 * config — the log and config must belong to the same account).
 */
export function replayTrades(config: SandboxConfig, trades: SandboxTrade[]): SandboxState {
  let state = createSandboxState(config);
  const slip = config.slippageBps / 10_000;
  for (const trade of trades) {
    const undoSlip = trade.side === 'BUY' ? 1 + slip : 1 - slip;
    const { state: next } = executeOrder(state, config, {
      timestampMs: trade.timestampMs,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.fillPrice / undoSlip,
    });
    state = next;
  }
  return state;
}

export interface MarkedPosition extends SandboxPosition {
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface PortfolioSnapshot {
  cash: number;
  equity: number;
  positions: MarkedPosition[];
  /** Symbols that could not be marked because no price was provided. */
  unpriced: string[];
}

export function markToMarket(state: SandboxState, prices: ReadonlyMap<string, number>): PortfolioSnapshot {
  const positions: MarkedPosition[] = [];
  const unpriced: string[] = [];
  let equity = state.cash;
  for (const position of state.positions.values()) {
    const lastPrice = prices.get(position.symbol);
    if (lastPrice === undefined || !(lastPrice > 0)) {
      unpriced.push(position.symbol);
      continue;
    }
    const marketValue = position.quantity * lastPrice;
    equity += marketValue;
    positions.push({
      ...position,
      lastPrice,
      marketValue,
      unrealizedPnl: (lastPrice - position.avgEntryPrice) * position.quantity,
    });
  }
  positions.sort((a, b) => b.marketValue - a.marketValue);
  return { cash: state.cash, equity, positions, unpriced: unpriced.sort() };
}
