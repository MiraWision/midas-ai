/** Autopilot persistence: instances + lots. Storage only. */

import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';

import type { CandleInterval } from '@/core/exchange/types';
import type { OpenLot } from '@/core/autopilot/plan';
import { db } from '@/db';
import { autopilotInstances, autopilotLots } from '@/db/schema';

export interface AutopilotInstance {
  id: string;
  strategyId: string;
  params: Record<string, unknown>;
  /** null = whole enabled universe. */
  symbols: string[] | null;
  interval: CandleInterval;
  accountId: string;
  quotePerTrade: number;
  fallbackHoldBars: number;
  enabled: boolean;
}

export async function createInstance(input: Omit<AutopilotInstance, 'id' | 'enabled'>): Promise<AutopilotInstance> {
  const id = randomUUID().slice(0, 8);
  await db.insert(autopilotInstances).values({
    id,
    strategyId: input.strategyId,
    paramsJson: JSON.stringify(input.params),
    symbolsJson: input.symbols ? JSON.stringify(input.symbols) : null,
    interval: input.interval,
    accountId: input.accountId,
    quotePerTrade: input.quotePerTrade,
    fallbackHoldBars: input.fallbackHoldBars,
  });
  return { ...input, id, enabled: true };
}

export async function listInstances(): Promise<AutopilotInstance[]> {
  const rows = await db.select().from(autopilotInstances).orderBy(asc(autopilotInstances.createdAt));
  return rows.map((row) => ({
    id: row.id,
    strategyId: row.strategyId,
    params: JSON.parse(row.paramsJson) as Record<string, unknown>,
    symbols: row.symbolsJson ? (JSON.parse(row.symbolsJson) as string[]) : null,
    interval: row.interval as CandleInterval,
    accountId: row.accountId,
    quotePerTrade: row.quotePerTrade,
    fallbackHoldBars: row.fallbackHoldBars,
    enabled: row.enabled,
  }));
}

export async function setInstanceEnabled(id: string, enabled: boolean): Promise<boolean> {
  const updated = await db
    .update(autopilotInstances)
    .set({ enabled })
    .where(eq(autopilotInstances.id, id))
    .returning({ id: autopilotInstances.id });
  return updated.length > 0;
}

export interface StoredLot extends OpenLot {
  id: string;
  instanceId: string;
}

export async function openLots(instanceId: string): Promise<StoredLot[]> {
  const rows = await db
    .select()
    .from(autopilotLots)
    .where(and(eq(autopilotLots.instanceId, instanceId), isNull(autopilotLots.closedAt)))
    .orderBy(asc(autopilotLots.openedAt));
  return rows.map((row) => ({
    id: row.id,
    instanceId: row.instanceId,
    symbol: row.symbol,
    quantity: row.quantity,
    exitDueMs: row.exitDueMs,
  }));
}

export async function recordLot(instanceId: string, lot: OpenLot): Promise<void> {
  await db.insert(autopilotLots).values({
    id: randomUUID().slice(0, 12),
    instanceId,
    symbol: lot.symbol,
    quantity: lot.quantity,
    exitDueMs: lot.exitDueMs,
  });
}

export async function closeLot(lotId: string): Promise<void> {
  await db.update(autopilotLots).set({ closedAt: new Date() }).where(eq(autopilotLots.id, lotId));
}
