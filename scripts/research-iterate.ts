/**
 * One autonomous research iteration, headless.
 *
 * Picks the top QUEUED hypothesis from research/hypotheses/queue.md, executes
 * it per its pre-registered plan (kill criteria fixed before the run), writes
 * the report + finding into research/, updates the queue and the test ledger.
 * The agent runs under the scoped permission profile (write research/** only)
 * with a hard budget and a wall-clock ceiling.
 *
 * Requires Claude Code installed and authenticated on this machine.
 *
 * Usage: pnpm research:iterate [--model sonnet|opus] [--budget-usd 5]
 *        [--resume <sessionId>]   # continue an iteration cut off mid-run
 *        [--dry-run]
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { ClaudeCodeRunner } from '../src/core/agent/claude-code-runner';
import { RESEARCH_AGENT_PROFILE } from '../src/core/agent/permissions';
import { RESEARCH_AGENT_SYSTEM_PROMPT } from '../src/core/agent/system-prompt';

const QUEUE_PATH = 'research/hypotheses/queue.md';
const DEFAULT_BUDGET_USD = 5;
// Experiments with permutation tests legitimately run long.
const ITERATION_TIMEOUT_MS = 3_600_000;

const ITERATION_PROMPT = `Run ONE research iteration:

1. Read research/README.md (methodology) and research/hypotheses/queue.md.
2. Take the top QUEUED hypothesis. If none are QUEUED, say so and stop. If a
   hypothesis lists an unmet prerequisite, mark it BLOCKED with the reason and
   take the next QUEUED one instead.
3. Mark it TESTING in the queue, dedup it against research/knowledge/ (gate 9),
   then execute it per its linked plan / kill criterion. Reuse the harness
   (src/core/research/event-study.ts) and pnpm strategy:run as reference; when
   a new runner is needed, author it in research/scripts/ and run it with
   pnpm tsx. Load candles from Postgres via src/db (market_candles).
4. Write the full report to research/reports/, a finding to research/knowledge/
   (documented format, evidence links; every number from script output), set
   the queue status to DONE or KILLED with links, and increment the family
   counter in research/hypotheses/ledger.md.
5. Finish with a short plain-text summary: hypothesis, verdict, key numbers,
   and what you changed in research/.

Honesty over positivity: apply the pre-registered kill criterion exactly.`;

const RESUME_PROMPT = `Continue the research iteration you were running in this session — the previous
turn was cut off by a wall-clock limit, not by you. Pick up exactly where you
stopped: finish the experiment per its pre-registered plan, then complete the
protocol (report, finding, queue status, ledger counter) and end with the
short plain-text summary.`;

function parseArgs(argv: string[]): { model: string; budgetUsd: number; dryRun: boolean; resumeSessionId: string | null } {
  let model = 'sonnet';
  let budgetUsd = DEFAULT_BUDGET_USD;
  let dryRun = false;
  let resumeSessionId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--model' && argv[i + 1]) {
      model = argv[i + 1]!;
      i += 1;
    } else if (argv[i] === '--budget-usd' && argv[i + 1]) {
      budgetUsd = Math.max(0.5, Number(argv[i + 1]) || DEFAULT_BUDGET_USD);
      i += 1;
    } else if (argv[i] === '--resume' && argv[i + 1]) {
      resumeSessionId = argv[i + 1]!;
      i += 1;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { model, budgetUsd, dryRun, resumeSessionId };
}

function queuedCount(queueMarkdown: string): number {
  return queueMarkdown.split('\n').filter((line) => line.includes('| QUEUED |')).length;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((token) => token !== '--');
  const { model, budgetUsd, dryRun, resumeSessionId } = parseArgs(argv);

  if (!existsSync(QUEUE_PATH)) throw new Error(`${QUEUE_PATH} not found — run from the repo root.`);
  const queued = queuedCount(readFileSync(QUEUE_PATH, 'utf8'));
  console.log(`[research-iterate] model=${model} budgetUsd=${budgetUsd} queued=${queued}${resumeSessionId ? ` resume=${resumeSessionId}` : ''}`);
  if (queued === 0 && !resumeSessionId) {
    console.log('[research-iterate] queue is empty — nothing to do.');
    return;
  }
  if (dryRun) {
    console.log('[research-iterate] dry run — would execute the top QUEUED hypothesis.');
    return;
  }

  const runner = new ClaudeCodeRunner();
  let lastStatus = '';
  const result = await runner.run({
    sessionId: resumeSessionId ?? randomUUID(),
    message: resumeSessionId ? RESUME_PROMPT : ITERATION_PROMPT,
    model,
    cwd: process.cwd(),
    isFirst: !resumeSessionId,
    systemPrompt: RESEARCH_AGENT_SYSTEM_PROMPT,
    permissions: RESEARCH_AGENT_PROFILE,
    maxBudgetUsd: budgetUsd,
    timeoutMs: ITERATION_TIMEOUT_MS,
    onEvent: (event) => {
      if (event.type === 'status' && event.status && event.status !== lastStatus) {
        lastStatus = event.status;
        console.log(`  … ${event.status}`);
      }
    },
  });

  console.log('\n===== research iteration summary =====\n');
  console.log(result.content.trim());
  console.log(`\n[research-iterate] done in ${(result.durationMs / 1000).toFixed(0)}s`);
}

main().catch((error) => {
  console.error('[research-iterate] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
