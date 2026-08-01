/**
 * One-time setup: from a fresh clone to a working MidasAI.
 *
 *   pnpm midas:setup                 # env + db + schema + first candle sync
 *   pnpm midas:setup -- --skip-db    # you run your own Postgres (set DATABASE_URL first)
 *   pnpm midas:setup -- --skip-sync  # skip the initial market sync
 *
 * Safe to re-run: every step is idempotent and skips what already exists.
 * After setup, day-to-day is just `pnpm dev` — and `pnpm midas:update` to
 * pull new versions.
 */

import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ARGV = process.argv.slice(2).filter((token) => token !== '--');
const skipDb = ARGV.includes('--skip-db');
const skipSync = ARGV.includes('--skip-sync');

function run(command: string, opts: { allowFail?: boolean } = {}): boolean {
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.status !== 0 && !opts.allowFail) {
    console.error(`\n[setup] step failed: ${command}`);
    process.exit(1);
  }
  return result.status === 0;
}

function step(title: string): void {
  console.log(`\n[32m▸ ${title}[0m`);
}

async function main(): Promise<void> {
  console.log('MidasAI setup — install once, then `pnpm midas:update` for new versions.');

  step('.env');
  if (existsSync('.env')) {
    console.log('  .env already exists — keeping it.');
  } else {
    copyFileSync('.env.example', '.env');
    console.log('  created .env from .env.example (defaults work with the bundled Postgres).');
  }

  if (!skipDb) {
    step('Postgres (docker compose)');
    const dockerOk = run('docker compose up -d db', { allowFail: true });
    if (!dockerOk) {
      console.error(
        '  Docker unavailable. Either install Docker, or run your own Postgres,\n' +
          '  point DATABASE_URL at it in .env, and re-run with --skip-db.'
      );
      process.exit(1);
    }
    // Wait for the server to accept connections before pushing the schema.
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      ready =
        spawnSync('docker compose exec -T db pg_isready -U midas -d midas', { shell: true, stdio: 'ignore' })
          .status === 0;
      if (!ready) execSync('sleep 1');
    }
    if (!ready) {
      console.error('  Postgres did not become ready in 30s — check `docker compose logs db`.');
      process.exit(1);
    }
    console.log('  Postgres is up.');
  }

  step('Database schema');
  run('pnpm db:push --force');

  if (!skipSync) {
    step('First market sync (top USDC markets, public API — no keys)');
    run('pnpm market:sync -- --refresh-universe');
  }

  step('Verify');
  run('pnpm test');

  step('midas CLI');
  // A plain wrapper in ~/.local/bin — no pnpm/npm global config required.
  const binDir = join(homedir(), '.local', 'bin');
  const wrapper = join(binDir, 'midas');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(wrapper, `#!/bin/sh\nexec node "${resolve('bin/midas.mjs')}" "$@"\n`, { mode: 0o755 });
  const onPath = (process.env.PATH ?? '').split(':').includes(binDir);
  console.log(`  installed ${wrapper}`);
  if (!onPath) {
    console.log('  NOTE: ~/.local/bin is not on your PATH — add this to your shell profile:');
    console.log('    export PATH="$HOME/.local/bin:$PATH"');
  }

  console.log(`
[32m✓ MidasAI is ready.[0m

  midas dev        → http://localhost:3000
  midas sync       → run on a schedule to accumulate history
  midas update     → pull the next version any time
  midas help       → everything else

Your files (src/strategies/, research/) survive updates — see docs/self-hosting.md.`);
}

main().catch((error) => {
  console.error('[setup] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
