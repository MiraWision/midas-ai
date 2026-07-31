import { describe, expect, it } from 'vitest';

import {
  createSandboxState,
  executeOrder,
  markToMarket,
  replayTrades,
  SandboxOrderError,
  type SandboxConfig,
  type SandboxTrade,
} from './engine';

const CONFIG: SandboxConfig = { quote: 'USDC', startingCash: 10_000, feeBps: 26, slippageBps: 5 };
const T = Date.UTC(2026, 0, 1);

function buy(qty: number, price: number, symbol = 'BTCUSDC') {
  return { timestampMs: T, symbol, side: 'BUY' as const, quantity: qty, price };
}
function sell(qty: number, price: number, symbol = 'BTCUSDC') {
  return { timestampMs: T + 1, symbol, side: 'SELL' as const, quantity: qty, price };
}

describe('executeOrder — BUY', () => {
  it('fills with adverse slippage and charges the fee on notional', () => {
    const { state, trade } = executeOrder(createSandboxState(CONFIG), CONFIG, buy(0.09, 100_000));
    expect(trade.fillPrice).toBeCloseTo(100_000 * 1.0005, 6); // +5bps against the buyer
    const notional = 0.09 * trade.fillPrice;
    expect(trade.fee).toBeCloseTo(notional * 0.0026, 6);
    expect(state.cash).toBeCloseTo(10_000 - notional - trade.fee, 6);
    expect(state.positions.get('BTCUSDC')!.quantity).toBeCloseTo(0.09);
  });

  it('volume-weights the average entry across adds', () => {
    let state = createSandboxState({ ...CONFIG, feeBps: 0, slippageBps: 0 });
    const cfg = { ...CONFIG, feeBps: 0, slippageBps: 0 };
    state = executeOrder(state, cfg, buy(1, 100, 'AAAUSDC')).state;
    state = executeOrder(state, cfg, buy(3, 200, 'AAAUSDC')).state;
    expect(state.positions.get('AAAUSDC')!.avgEntryPrice).toBeCloseTo(175);
    expect(state.positions.get('AAAUSDC')!.quantity).toBeCloseTo(4);
  });

  it('rejects a buy the cash cannot cover, fee included', () => {
    const state = createSandboxState(CONFIG);
    // 0.1 × 100k ≈ 10,004 with slippage+fee > 10,000 cash
    expect(() => executeOrder(state, CONFIG, buy(0.1, 100_000 * 0.9999))).toThrow(SandboxOrderError);
  });
});

describe('executeOrder — SELL', () => {
  it('realizes PnL net of the sell fee', () => {
    const cfg = { ...CONFIG, feeBps: 10, slippageBps: 0 };
    let state = executeOrder(createSandboxState(cfg), cfg, buy(1, 1_000, 'ETHUSDC')).state;
    const result = executeOrder(state, cfg, sell(1, 1_100, 'ETHUSDC'));
    state = result.state;
    const entryWithFee = 1_000 * 1.001; // buy fee charged to cash, not entry price
    expect(result.trade.realizedPnl).toBeCloseTo((1_100 - 1_000) * 1 - 1_100 * 0.001, 6);
    expect(state.positions.has('ETHUSDC')).toBe(false);
    expect(state.cash).toBeCloseTo(10_000 - entryWithFee + 1_100 * (1 - 0.001), 6);
  });

  it('supports partial closes and keeps the entry price', () => {
    const cfg = { ...CONFIG, feeBps: 0, slippageBps: 0 };
    let state = executeOrder(createSandboxState(cfg), cfg, buy(2, 500, 'SOLUSDC')).state;
    state = executeOrder(state, cfg, sell(0.5, 600, 'SOLUSDC')).state;
    const pos = state.positions.get('SOLUSDC')!;
    expect(pos.quantity).toBeCloseTo(1.5);
    expect(pos.avgEntryPrice).toBeCloseTo(500);
  });

  it('rejects overselling — the sandbox is long-only', () => {
    const state = executeOrder(createSandboxState(CONFIG), CONFIG, buy(0.05, 10_000)).state;
    expect(() => executeOrder(state, CONFIG, sell(0.06, 10_000))).toThrow(/long-only/);
    expect(() => executeOrder(createSandboxState(CONFIG), CONFIG, sell(1, 10))).toThrow(SandboxOrderError);
  });
});

describe('replayTrades', () => {
  it('reconstructs the exact state from the trade log', () => {
    let state = createSandboxState(CONFIG);
    const trades: SandboxTrade[] = [];
    for (const order of [buy(0.05, 90_000), buy(0.05, 95_000), sell(0.03, 100_000)]) {
      const result = executeOrder(state, CONFIG, order);
      state = result.state;
      trades.push(result.trade);
    }
    const replayed = replayTrades(CONFIG, trades);
    expect(replayed.cash).toBeCloseTo(state.cash, 8);
    expect(replayed.positions.get('BTCUSDC')!.quantity).toBeCloseTo(state.positions.get('BTCUSDC')!.quantity, 10);
    expect(replayed.positions.get('BTCUSDC')!.avgEntryPrice).toBeCloseTo(
      state.positions.get('BTCUSDC')!.avgEntryPrice,
      8
    );
  });
});

describe('markToMarket', () => {
  it('computes equity, unrealized PnL and reports unpriced symbols', () => {
    const cfg = { ...CONFIG, feeBps: 0, slippageBps: 0 };
    let state = executeOrder(createSandboxState(cfg), cfg, buy(1, 2_000, 'ETHUSDC')).state;
    state = executeOrder(state, cfg, buy(10, 100, 'SOLUSDC')).state;

    const snapshot = markToMarket(state, new Map([['ETHUSDC', 2_500]]));
    expect(snapshot.unpriced).toEqual(['SOLUSDC']);
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]!.unrealizedPnl).toBeCloseTo(500);
    // Equity counts cash + priced positions only; unpriced are surfaced, not guessed.
    expect(snapshot.equity).toBeCloseTo(10_000 - 2_000 - 1_000 + 2_500);
  });
});
