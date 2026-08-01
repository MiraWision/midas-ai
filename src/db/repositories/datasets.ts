/**
 * Dataset persistence + the database-backed DatasetContext. Storage only —
 * all computation lives in the DatasetDefinition builders.
 */

import { and, asc, eq } from 'drizzle-orm';

import type { Candle, CandleInterval } from '@/core/exchange/types';
import type { DatasetContext, DatasetRow, DatasetValue } from '@/core/datasets/types';
import { db } from '@/db';
import { datasetBuilds, datasetRows, marketCandles } from '@/db/schema';
import { universeRepository } from './market';

const CHUNK = 500;

export async function replaceDatasetRows(
  datasetId: string,
  rows: DatasetRow[],
  params: Record<string, unknown>
): Promise<void> {
  await db.delete(datasetRows).where(eq(datasetRows.datasetId, datasetId));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(datasetRows).values(
      rows.slice(i, i + CHUNK).map((row) => ({
        datasetId,
        key: row.key,
        timestampMs: row.timestampMs,
        valuesJson: JSON.stringify(row.values),
      }))
    );
  }
  await db
    .insert(datasetBuilds)
    .values({ datasetId, builtAt: new Date(), rowCount: rows.length, paramsJson: JSON.stringify(params) })
    .onConflictDoUpdate({
      target: datasetBuilds.datasetId,
      set: { builtAt: new Date(), rowCount: rows.length, paramsJson: JSON.stringify(params) },
    });
}

export interface DatasetBuildInfo {
  datasetId: string;
  builtAt: Date;
  rowCount: number;
  params: Record<string, unknown>;
}

export async function readBuildInfo(): Promise<Map<string, DatasetBuildInfo>> {
  const rows = await db.select().from(datasetBuilds);
  return new Map(
    rows.map((row) => [
      row.datasetId,
      {
        datasetId: row.datasetId,
        builtAt: row.builtAt,
        rowCount: row.rowCount,
        params: JSON.parse(row.paramsJson) as Record<string, unknown>,
      },
    ])
  );
}

export async function readDatasetRows(
  datasetId: string,
  options?: { key?: string; limit?: number }
): Promise<DatasetRow[]> {
  const conditions = [eq(datasetRows.datasetId, datasetId)];
  if (options?.key) conditions.push(eq(datasetRows.key, options.key));
  const rows = await db
    .select()
    .from(datasetRows)
    .where(and(...conditions))
    .orderBy(asc(datasetRows.key), asc(datasetRows.timestampMs))
    .limit(options?.limit ?? 10_000);
  return rows.map((row) => ({
    key: row.key,
    timestampMs: row.timestampMs,
    values: JSON.parse(row.valuesJson) as Record<string, DatasetValue>,
  }));
}

/** DatasetContext backed by the real database. */
export function createDbDatasetContext(source = 'kraken', nowMs = Date.now()): DatasetContext {
  return {
    nowMs,
    symbols: () => universeRepository.listEnabled(source),
    async candles(symbol: string, interval: CandleInterval): Promise<Candle[]> {
      const rows = await db
        .select()
        .from(marketCandles)
        .where(
          and(eq(marketCandles.source, source), eq(marketCandles.symbol, symbol), eq(marketCandles.interval, interval))
        )
        .orderBy(asc(marketCandles.openTimeMs));
      return rows.map((r) => ({
        openTimeMs: r.openTimeMs,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }));
    },
  };
}
