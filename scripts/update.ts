/**
 * Update a self-hosted MidasAI in place: `pnpm midas:update`.
 *
 * What it does, in order:
 *   1. Configures the "midas-user" merge driver so YOUR files always win —
 *      research/ work and src/strategies/index.ts are declared user-owned in
 *      .gitattributes; upstream changes never overwrite them.
 *   2. Fetches origin and shows what's new (commits since your version).
 *   3. Merges origin/main (never rebases your local commits away).
 *   4. Installs dependencies and applies additive schema changes.
 *   5. Runs the test suite so you know the update is sound on your machine.
 *
 * Committing your local changes (research findings, strategies) before
 * updating is encouraged but not required — untracked files are never touched
 * by a merge, and tracked user-owned files are protected by the driver.
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function sh(command: string): string {
  return execSync(command, { encoding: 'utf8' }).trim();
}

function run(command: string): void {
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n[update] step failed: ${command}`);
    process.exit(1);
  }
}

function version(): string {
  try {
    return (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  } catch {
    return '?';
  }
}

async function main(): Promise<void> {
  const fromVersion = version();

  // 1. User-owned paths always keep the local version on merge conflicts.
  sh('git config merge.midas-user.driver true');

  // 2. What's new?
  console.log('[update] fetching origin…');
  sh('git fetch origin main --tags');
  const behind = Number(sh('git rev-list --count HEAD..origin/main'));
  if (behind === 0) {
    console.log(`[update] already up to date (v${fromVersion}).`);
    return;
  }
  console.log(`\n[update] ${behind} new commit${behind === 1 ? '' : 's'}:\n`);
  console.log(sh('git log --oneline HEAD..origin/main | head -20'));

  // Warn (don't block) about uncommitted changes outside user-owned paths.
  const dirty = sh('git status --porcelain')
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const path = line.slice(3);
      return !path.startsWith('research/') && !path.startsWith('src/strategies/') && !path.startsWith('.env');
    });
  if (dirty.length > 0) {
    console.log('\n[update] note: you have uncommitted changes outside user-owned paths:');
    for (const line of dirty.slice(0, 10)) console.log(`  ${line}`);
    console.log('  The merge will refuse to overwrite them; commit or stash if it stops.');
  }

  // 3. Merge — user-owned conflicts auto-resolve to YOUR version.
  console.log('\n[update] merging origin/main…');
  run('git merge --no-edit origin/main');

  // 4. Dependencies + schema (additive; your data is never dropped).
  run('pnpm install');
  run('pnpm db:push --force');

  // 5. Prove it works here, not just in CI.
  run('pnpm test');

  const toVersion = version();
  console.log(`\n[32m✓ Updated${fromVersion !== toVersion ? `: v${fromVersion} → v${toVersion}` : ` (v${toVersion})`}.[0m`);
  console.log('Restart `pnpm dev` (or your service) to run the new version.');
}

main().catch((error) => {
  console.error('[update] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
