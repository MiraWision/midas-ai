/**
 * Dataset CLI:
 *   midas dataset list
 *   midas dataset build <id>
 *   midas dataset show <id> [--key BTCUSDC] [--limit 20]
 */

import { createDbDatasetContext, readBuildInfo, readDatasetRows, replaceDatasetRows } from '../src/db/repositories/datasets';
import { DATASETS, getDataset } from '../src/datasets';

const ARGV = process.argv.slice(2).filter((token) => token !== '--');
function arg(name: string): string | undefined {
  const idx = ARGV.indexOf(`--${name}`);
  return idx >= 0 ? ARGV[idx + 1] : undefined;
}

async function cmdList(): Promise<void> {
  const info = await readBuildInfo().catch(() => new Map());
  for (const dataset of DATASETS) {
    const built = info.get(dataset.id);
    const status = built
      ? `${built.rowCount} rows, built ${built.builtAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
      : 'not built';
    console.log(`${dataset.id.padEnd(20)} ${status}`);
    console.log(`  ${dataset.description}`);
  }
}

async function cmdBuild(id: string | undefined): Promise<void> {
  const dataset = id ? getDataset(id) : undefined;
  if (!dataset) throw new Error(`unknown dataset "${id ?? ''}" — see: midas dataset list`);
  const startedAt = Date.now();
  const rows = await dataset.build(createDbDatasetContext(), dataset.defaultParams);
  await replaceDatasetRows(dataset.id, rows, dataset.defaultParams);
  console.log(`[dataset] ${dataset.id}: ${rows.length} rows in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

async function cmdShow(id: string | undefined): Promise<void> {
  const dataset = id ? getDataset(id) : undefined;
  if (!dataset) throw new Error(`unknown dataset "${id ?? ''}" — see: midas dataset list`);
  const rows = await readDatasetRows(dataset.id, { key: arg('key'), limit: Number(arg('limit') ?? 20) });
  if (rows.length === 0) {
    console.log(`no rows — build first: midas dataset build ${dataset.id}`);
    return;
  }
  const columns = dataset.columns.map((c) => c.name);
  console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(
      columns
        .map((c) => {
          const v = row.values[c];
          return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v ?? '');
        })
        .join('\t')
    );
  }
}

async function main(): Promise<void> {
  const [command, id] = ARGV;
  if (command === 'list') return cmdList();
  if (command === 'build') return cmdBuild(id);
  if (command === 'show') return cmdShow(id);
  console.log('usage: midas dataset list | build <id> | show <id> [--key K] [--limit N]');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
