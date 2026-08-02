/**
 * Autopilot — surviving strategies paper-trade themselves.
 *
 *   midas autopilot add --strategy sma-cross --account <sandboxId>
 *       [--params '{"fastBars":12,"slowBars":48}'] [--symbols BTCUSDC,ETHUSDC]
 *       [--interval 1h] [--quote-per-trade 500] [--hold-bars 24]
 *   midas autopilot list | enable <id> | disable <id>
 *   midas autopilot tick [--no-sync]     ← cron this at your bar interval
 *
 * One tick = for every enabled instance: sync its candles, close due lots at
 * live bid, run analyze() on closed bars, open fresh LONG signals at live ask
 * through the sandbox. All decisions come from core/autopilot/plan.ts (pure,
 * tested); this script is plumbing.
 */

import { KrakenMarketData } from '../src/core/exchange/kraken/market-data';
import { CANDLE_INTERVAL_MS, type CandleInterval } from '../src/core/exchange/types';
import { planTick } from '../src/core/autopilot/plan';
import { executeOrder, replayTrades } from '../src/core/sandbox/engine';
import { syncCandles } from '../src/core/market/candle-sync';
import {
  closeLot,
  createInstance,
  listInstances,
  openLots,
  recordLot,
  setInstanceEnabled,
  type AutopilotInstance,
} from '../src/db/repositories/autopilot';
import { candleRepository, universeRepository } from '../src/db/repositories/market';
import { appendTrade, getAccount, loadTrades } from '../src/db/repositories/sandbox';
import { loadRecentCandles } from '../src/server/chart-data';
import { getStrategy } from '../src/strategies';

const ARGV = process.argv.slice(2).filter((token) => token !== '--');
function arg(name: string): string | undefined {
  const idx = ARGV.indexOf(`--${name}`);
  return idx >= 0 ? ARGV[idx + 1] : undefined;
}

async function cmdAdd(): Promise<void> {
  const strategyId = arg('strategy');
  if (!strategyId || !getStrategy(strategyId)) throw new Error('--strategy <registered id> is required');
  const accountId = arg('account');
  if (!accountId || !(await getAccount(accountId))) {
    throw new Error('--account <sandbox id> is required (midas sandbox list / create)');
  }
  const strategy = getStrategy(strategyId)!;
  const params = { ...strategy.defaultParams, ...(arg('params') ? JSON.parse(arg('params')!) : {}) };

  const instance = await createInstance({
    strategyId,
    params,
    symbols: arg('symbols')?.split(',').map((s) => s.trim().toUpperCase()) ?? null,
    interval: (arg('interval') ?? '1h') as CandleInterval,
    accountId,
    quotePerTrade: Number(arg('quote-per-trade') ?? 500),
    fallbackHoldBars: Math.max(1, Number(arg('hold-bars') ?? 24)),
  });
  console.log(`autopilot instance ${instance.id}: ${strategyId} → account ${accountId} (${instance.interval})`);
  console.log('cron a tick at your bar interval: midas autopilot tick');
}

async function cmdList(): Promise<void> {
  const instances = await listInstances();
  if (instances.length === 0) {
    console.log('no instances — midas autopilot add --strategy <id> --account <sandbox id>');
    return;
  }
  for (const instance of instances) {
    const lots = await openLots(instance.id);
    console.log(
      `${instance.id}  ${instance.enabled ? 'ON ' : 'off'}  ${instance.strategyId} ${instance.interval}` +
        `  → ${instance.accountId}  ${instance.symbols?.join(',') ?? 'universe'}  open lots: ${lots.length}`
    );
  }
}

async function cmdSetEnabled(id: string | undefined, enabled: boolean): Promise<void> {
  if (!id || !(await setInstanceEnabled(id, enabled))) throw new Error(`no instance "${id ?? ''}"`);
  console.log(`${id} ${enabled ? 'enabled' : 'disabled'}`);
}

async function tickInstance(adapter: KrakenMarketData, instance: AutopilotInstance, noSync: boolean): Promise<void> {
  const account = await getAccount(instance.accountId);
  if (!account) {
    console.error(`[${instance.id}] sandbox account ${instance.accountId} missing — skipping`);
    return;
  }
  const symbols = instance.symbols ?? (await universeRepository.listEnabled(adapter.id));
  const intervalMs = CANDLE_INTERVAL_MS[instance.interval];
  const nowMs = Date.now();

  if (!noSync) await syncCandles(adapter, candleRepository, symbols, { intervals: [instance.interval], nowMs });

  const strategy = getStrategy(instance.strategyId);
  if (!strategy) {
    console.error(`[${instance.id}] strategy ${instance.strategyId} not registered — skipping`);
    return;
  }
  const candlesBySymbol = new Map<string, Awaited<ReturnType<typeof loadRecentCandles>>>();
  for (const symbol of symbols) {
    const candles = await loadRecentCandles(adapter.id, symbol, instance.interval, 720);
    if (candles.length > 0) candlesBySymbol.set(symbol, candles);
  }

  const signals = strategy.analyze(
    { candles: candlesBySymbol, interval: instance.interval, nowMs },
    instance.params as never
  );
  const lots = await openLots(instance.id);
  const plan = planTick({ signals, openLots: lots, nowMs, intervalMs, fallbackHoldMs: instance.fallbackHoldBars * intervalMs });

  let state = replayTrades(account, await loadTrades(account.id));

  for (const lot of plan.toClose) {
    const stored = lots.find((l) => l.symbol === lot.symbol && l.exitDueMs === lot.exitDueMs);
    try {
      const price = (await adapter.fetchTicker(lot.symbol)).bid;
      const result = executeOrder(state, account, {
        timestampMs: nowMs,
        symbol: lot.symbol,
        side: 'SELL',
        quantity: lot.quantity,
        price,
      });
      state = result.state;
      await appendTrade(account.id, result.trade);
      if (stored) await closeLot(stored.id);
      console.log(`[${instance.id}] CLOSE ${lot.symbol} ${lot.quantity.toFixed(8)} → realized ${result.trade.realizedPnl.toFixed(2)}`);
    } catch (error) {
      console.error(`[${instance.id}] close ${lot.symbol} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  for (const entry of plan.toOpen) {
    try {
      const price = (await adapter.fetchTicker(entry.signal.symbol)).ask;
      const quantity = instance.quotePerTrade / price;
      const result = executeOrder(state, account, {
        timestampMs: nowMs,
        symbol: entry.signal.symbol,
        side: 'BUY',
        quantity,
        price,
      });
      state = result.state;
      await appendTrade(account.id, result.trade);
      await recordLot(instance.id, { symbol: entry.signal.symbol, quantity, exitDueMs: entry.exitDueMs });
      console.log(`[${instance.id}] OPEN ${entry.signal.symbol} ${quantity.toFixed(8)} @ ${result.trade.fillPrice.toFixed(4)}`);
    } catch (error) {
      console.error(`[${instance.id}] open ${entry.signal.symbol} skipped: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(
    `[${instance.id}] tick: ${signals.length} signals → open ${plan.toOpen.length}, close ${plan.toClose.length}` +
      ` (skips: ${plan.skippedShorts} short, ${plan.skippedStale} stale, ${plan.skippedAlreadyOpen} held) · cash ${state.cash.toFixed(2)}`
  );
}

async function cmdTick(): Promise<void> {
  const instances = (await listInstances()).filter((instance) => instance.enabled);
  if (instances.length === 0) {
    console.log('no enabled instances.');
    return;
  }
  const adapter = new KrakenMarketData();
  for (const instance of instances) {
    await tickInstance(adapter, instance, ARGV.includes('--no-sync'));
  }
}

async function main(): Promise<void> {
  const [command, id] = ARGV;
  if (command === 'add') return cmdAdd();
  if (command === 'list') return cmdList();
  if (command === 'enable') return cmdSetEnabled(id, true);
  if (command === 'disable') return cmdSetEnabled(id, false);
  if (command === 'tick') return cmdTick();
  console.log('usage: midas autopilot add|list|enable <id>|disable <id>|tick [--no-sync]');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
