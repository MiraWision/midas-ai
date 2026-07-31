/**
 * Sandbox CLI — paper trading against live Kraken prices.
 *
 *   pnpm sandbox -- create --name my-test --cash 10000
 *   pnpm sandbox -- list
 *   pnpm sandbox -- order --account <id> --symbol BTCUSDC --side BUY --quantity 0.01
 *   pnpm sandbox -- order --account <id> --symbol BTCUSDC --side BUY --quote-amount 500
 *   pnpm sandbox -- status --account <id>
 *
 * Fills are pessimistic (slippage against you + taker fee). Defaults model
 * Kraken spot taker: fee 26bps, slippage 5bps — override at account creation
 * with --fee-bps / --slippage-bps.
 */

import { KrakenMarketData } from '../src/core/exchange/kraken/market-data';
import { executeOrder, markToMarket, replayTrades, type SandboxSide } from '../src/core/sandbox/engine';
import {
  appendTrade,
  createAccount,
  getAccount,
  listAccounts,
  loadTrades,
} from '../src/db/repositories/sandbox';

// pnpm forwards a literal "--" separator into argv — drop it.
const ARGV = process.argv.slice(2).filter((token) => token !== '--');

function arg(name: string): string | undefined {
  const idx = ARGV.indexOf(`--${name}`);
  return idx >= 0 ? ARGV[idx + 1] : undefined;
}

async function cmdCreate(): Promise<void> {
  const name = arg('name') ?? 'default';
  const account = await createAccount(name, {
    quote: (arg('quote') ?? 'USDC').toUpperCase(),
    startingCash: Number(arg('cash') ?? 10_000),
    feeBps: Number(arg('fee-bps') ?? 26),
    slippageBps: Number(arg('slippage-bps') ?? 5),
  });
  console.log(`created sandbox account ${account.id} (${account.name}): ${account.startingCash} ${account.quote}`);
}

async function cmdList(): Promise<void> {
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    console.log('no sandbox accounts — create one with: pnpm sandbox -- create --name test');
    return;
  }
  for (const a of accounts) {
    console.log(`${a.id}  ${a.name}  start ${a.startingCash} ${a.quote}  fee ${a.feeBps}bps slip ${a.slippageBps}bps`);
  }
}

async function requireAccount() {
  const id = arg('account');
  if (!id) throw new Error('--account <id> is required (see: pnpm sandbox -- list)');
  const account = await getAccount(id);
  if (!account) throw new Error(`no sandbox account "${id}"`);
  return account;
}

async function cmdOrder(): Promise<void> {
  const account = await requireAccount();
  const symbol = arg('symbol')?.toUpperCase();
  const side = arg('side')?.toUpperCase() as SandboxSide | undefined;
  if (!symbol || (side !== 'BUY' && side !== 'SELL')) throw new Error('--symbol and --side BUY|SELL are required');

  const adapter = new KrakenMarketData();
  const ticker = await adapter.fetchTicker(symbol);
  const price = side === 'BUY' ? ticker.ask : ticker.bid;
  if (!(price > 0)) throw new Error(`no live price for ${symbol}`);

  const quoteAmount = arg('quote-amount');
  const quantity = quoteAmount !== undefined ? Number(quoteAmount) / price : Number(arg('quantity'));
  if (!(quantity > 0)) throw new Error('--quantity <base> or --quote-amount <quote> is required');

  const trades = await loadTrades(account.id);
  const state = replayTrades(account, trades);
  const result = executeOrder(state, account, { timestampMs: Date.now(), symbol, side, quantity, price });
  await appendTrade(account.id, result.trade);

  const t = result.trade;
  console.log(
    `${t.side} ${t.quantity.toFixed(8)} ${t.symbol} @ ${t.fillPrice.toFixed(4)} (fee ${t.fee.toFixed(4)})` +
      (t.side === 'SELL' ? ` realized ${t.realizedPnl.toFixed(4)} ${account.quote}` : '')
  );
  console.log(`cash: ${result.state.cash.toFixed(2)} ${account.quote}`);
}

async function cmdStatus(): Promise<void> {
  const account = await requireAccount();
  const trades = await loadTrades(account.id);
  const state = replayTrades(account, trades);

  const adapter = new KrakenMarketData();
  const prices = new Map<string, number>();
  for (const symbol of state.positions.keys()) {
    try {
      prices.set(symbol, (await adapter.fetchTicker(symbol)).last);
    } catch {
      // leave unpriced; markToMarket reports it
    }
  }

  const snapshot = markToMarket(state, prices);
  const realized = trades.reduce((sum, t) => sum + t.realizedPnl, 0);
  console.log(`account ${account.id} (${account.name}) — ${trades.length} trades`);
  for (const p of snapshot.positions) {
    console.log(
      `  ${p.symbol}: ${p.quantity.toFixed(8)} @ avg ${p.avgEntryPrice.toFixed(4)} → ${p.lastPrice.toFixed(4)}` +
        `  value ${p.marketValue.toFixed(2)}  uPnL ${p.unrealizedPnl >= 0 ? '+' : ''}${p.unrealizedPnl.toFixed(2)}`
    );
  }
  if (snapshot.unpriced.length > 0) console.log(`  (no live price: ${snapshot.unpriced.join(', ')})`);
  console.log(`cash ${snapshot.cash.toFixed(2)} ${account.quote} · equity ${snapshot.equity.toFixed(2)}`);
  const totalPnl = snapshot.equity - account.startingCash;
  console.log(
    `PnL: total ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} (realized ${realized >= 0 ? '+' : ''}${realized.toFixed(2)})`
  );
}

async function main(): Promise<void> {
  const command = ARGV[0];
  if (command === 'create') return cmdCreate();
  if (command === 'list') return cmdList();
  if (command === 'order') return cmdOrder();
  if (command === 'status') return cmdStatus();
  console.log('usage: pnpm sandbox -- create|list|order|status [flags] (see file header)');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
