# Agent on rails

MidasAI can run a coding agent — [Claude Code](https://claude.com/claude-code)
ships as the first adapter — as an autonomous researcher over your hypothesis
queue.

## Setup

1. Install Claude Code and authenticate it on this machine (`claude` must work
   from your shell).
2. Make sure candles are synced (`pnpm market:sync`) and your queue has a
   hypothesis with a kill criterion (`research/hypotheses/queue.md`).
3. Run one budgeted iteration:

```bash
pnpm research:iterate -- --model sonnet --budget-usd 5
```

One iteration = one hypothesis, end to end. `--resume <sessionId>` continues a
run that hit the wall-clock ceiling; `--dry-run` just inspects the queue.
Schedule it (cron) for unattended iterations if you like — each run is capped
by budget and timeout.

## The trust model

The agent is treated as a capable but fallible researcher, and honesty is
enforced structurally:

- **Scoped writes.** The permission profile allows writing ONLY inside
  `research/**`. Source code, migrations, env files and git surface are
  explicitly denied.
- **Allow-listed toolchain.** The agent can run the research runners, tests
  and typecheck — not arbitrary commands.
- **Budgeted runs.** Each headless iteration carries a hard USD spend cap and
  a wall-clock ceiling.
- **Numbers from the harness only.** The methodology (research/README.md,
  gate #10) forbids the agent from authoring metrics; every number in a
  finding must reproduce from a script in the repo.

## The iteration loop

One iteration = one hypothesis: take the top QUEUED entry, execute it per its
pre-registered plan, write the report and the finding, update the queue and
the test ledger, stop. The agent never invents kill criteria after the fact,
and a killed hypothesis is a successful iteration.
