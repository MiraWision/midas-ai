#!/usr/bin/env node
/**
 * The `midas` CLI — one entry point for every platform command.
 *
 * Installed globally by `pnpm link --global` (midas:setup does this for you),
 * it always executes inside the repo it was linked from, so it works from any
 * directory. Zero dependencies: it only dispatches to the project's scripts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const COMMANDS = {
  setup: { script: 'scripts/setup.ts', help: 'one-time install: env + db + schema + sync + tests' },
  update: { script: 'scripts/update.ts', help: 'pull the next version (your files survive)' },
  sync: { script: 'scripts/sync-candles.ts', help: 'sync candles for the tracked universe' },
  backfill: { script: 'scripts/backfill-trades.ts', help: 'deep history from trades (--from YYYY-MM-DD)' },
  dataset: { script: 'scripts/dataset.ts', help: 'derived tables: list | build <id> | show <id>' },
  sandbox: { script: 'scripts/sandbox.ts', help: 'paper trading: create | list | order | status' },
  run: { script: 'scripts/run-strategy.ts', help: 'two-stage strategy evaluation (--strategy <id>)' },
  iterate: { script: 'scripts/research-iterate.ts', help: 'one budgeted agent research iteration' },
};

const PNPM_PASSTHROUGH = new Set(['dev', 'build', 'start', 'test', 'lint', 'typecheck']);

function usage() {
  const rows = Object.entries(COMMANDS)
    .map(([name, { help }]) => `  midas ${name.padEnd(9)} ${help}`)
    .join('\n');
  console.log(`midas — an honest research environment for algorithmic trading

${rows}
  midas db <cmd>   database: push | studio | generate
  midas ${[...PNPM_PASSTHROUGH].join(' | ')}
  midas version    show the installed version

Flags after the command go to the underlying tool, e.g.:
  midas sync --refresh-universe
  midas sandbox order --account <id> --symbol BTCUSDC --side BUY --quote-amount 500
  midas run --strategy sma-cross --interval 1h`);
}

function exec(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  process.exit(result.status ?? 1);
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === 'help' || command === '--help' || command === '-h') {
  usage();
  process.exit(command ? 0 : 1);
}

if (command === 'version' || command === '--version' || command === '-v') {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  console.log(`midas v${pkg.version} (${ROOT})`);
  process.exit(0);
}

if (command === 'db') {
  const sub = rest[0];
  if (!['push', 'studio', 'generate'].includes(sub ?? '')) {
    console.error('usage: midas db push|studio|generate');
    process.exit(1);
  }
  exec('pnpm', [`db:${sub}`, ...rest.slice(1)]);
}

if (PNPM_PASSTHROUGH.has(command)) {
  exec('pnpm', [command, ...rest]);
}

const entry = COMMANDS[command];
if (!entry) {
  console.error(`midas: unknown command "${command}"\n`);
  usage();
  process.exit(1);
}

const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
if (!existsSync(tsx)) {
  console.error('midas: dependencies missing — run `pnpm install` in the project first.');
  process.exit(1);
}
exec(tsx, [join(ROOT, entry.script), ...rest]);
