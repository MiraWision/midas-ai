# Agent on rails (roadmap preview)

MidasAI is designed to run a coding agent — e.g. [Claude Code](https://claude.com/claude-code) —
as an autonomous researcher over your hypothesis queue. The runner is being
ported; this document describes the contract so you know what's coming and
what to build against (`src/core/agent/types.ts`).

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
