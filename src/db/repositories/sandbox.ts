/**
 * Sandbox persistence: accounts + the append-only trade log. State is never
 * written — it's replayed from trades by the pure engine, so this layer is
 * storage only.
 */

import { randomUUID } from 'node:crypto';

import { asc, desc, eq } from 'drizzle-orm';

import type { SandboxConfig, SandboxTrade } from '@/core/sandbox/engine';
import { db } from '@/db';
import { sandboxAccounts, sandboxTrades } from '@/db/schema';

export interface SandboxAccount extends SandboxConfig {
  id: string;
  name: string;
  createdAt: Date;
}

export async function createAccount(name: string, config: SandboxConfig): Promise<SandboxAccount> {
  const id = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(sandboxAccounts)
    .values({
      id,
      name,
      quote: config.quote,
      startingCash: config.startingCash,
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
    })
    .returning();
  return toAccount(row!);
}

export async function getAccount(id: string): Promise<SandboxAccount | null> {
  const rows = await db.select().from(sandboxAccounts).where(eq(sandboxAccounts.id, id)).limit(1);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function listAccounts(): Promise<SandboxAccount[]> {
  const rows = await db.select().from(sandboxAccounts).orderBy(asc(sandboxAccounts.createdAt));
  return rows.map(toAccount);
}

export async function loadTrades(accountId: string): Promise<SandboxTrade[]> {
  const rows = await db
    .select()
    .from(sandboxTrades)
    .where(eq(sandboxTrades.accountId, accountId))
    .orderBy(asc(sandboxTrades.seq));
  return rows.map((row) => ({
    timestampMs: row.timestampMs,
    symbol: row.symbol,
    side: row.side as SandboxTrade['side'],
    quantity: row.quantity,
    fillPrice: row.fillPrice,
    fee: row.fee,
    realizedPnl: row.realizedPnl,
  }));
}

export async function appendTrade(accountId: string, trade: SandboxTrade): Promise<void> {
  const last = await db
    .select({ seq: sandboxTrades.seq })
    .from(sandboxTrades)
    .where(eq(sandboxTrades.accountId, accountId))
    .orderBy(desc(sandboxTrades.seq))
    .limit(1);
  const seq = (last[0]?.seq ?? 0) + 1;
  await db.insert(sandboxTrades).values({
    accountId,
    seq,
    timestampMs: trade.timestampMs,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    fillPrice: trade.fillPrice,
    fee: trade.fee,
    realizedPnl: trade.realizedPnl,
  });
}

function toAccount(row: typeof sandboxAccounts.$inferSelect): SandboxAccount {
  return {
    id: row.id,
    name: row.name,
    quote: row.quote,
    startingCash: row.startingCash,
    feeBps: row.feeBps,
    slippageBps: row.slippageBps,
    createdAt: row.createdAt,
  };
}
