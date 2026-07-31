# Research workspace

This directory is where hypotheses live and die. It is also the ONLY place an
autonomous research agent gets write access — the rest of the repository is
read-only for it by permission profile, not by politeness.

## Structure

```
research/
├── README.md          # this file — the methodology, which is law
├── knowledge/         # journal of findings: one file = one finding
├── hypotheses/
│   ├── queue.md       # the hypothesis queue (human + agent sourced)
│   └── ledger.md      # test-count ledger: multiple-comparisons accounting
└── reports/           # full experiment reports (markdown)
```

## Methodology — law, not preference

Every experiment passes these gates. A finding that skipped one does not get
written to knowledge/, whatever its result.

1. **Pre-registration.** The kill criterion is fixed BEFORE the experiment —
   in a plan document or in the queue entry itself. Moving the goalposts
   after seeing data is prohibited.
2. **Permutation null.** Every "edge exists" / "feature works" claim is backed
   by a permutation test (`src/core/research/event-study.ts` or an equivalent
   explicit null). There is no such thing as an eyeballed p-value.
3. **Costs always.** All returns are net of costs; shorts cost more (margin
   rollover). A cost-sensitivity pass is mandatory.
4. **IS/OOS.** The in-sample / out-of-sample split is mandatory; a feature
   that flips sign between halves is declared noise regardless of p-value.
5. **Multiple comparisons.** Looked at 15 cells? Say "one of 15", not "found a
   signal". Significance at large n is worthless by itself — judge effect
   size against costs.
6. **Negative results are results.** Recorded in knowledge/ with the same
   care as positives.
7. **Two-stage gate.** A cheap signal-level test (event study / IC /
   permutation) with pre-registered thresholds runs first; the expensive
   walk-forward backtest runs ONLY if stage one passes. Most hypotheses
   should die at stage one — that is cheap and correct.
8. **Code implements the registered hypothesis.** No drifting the wording to
   fit what the data shows: a changed hypothesis is a NEW queue entry with
   its own kill criteria. Free parameters are minimal and declared in the
   plan; every undeclared parameter is a hidden degree of freedom.
9. **Dedup and the ledger.** Before starting, check knowledge/: a re-skin of
   an already-tested idea is not a new hypothesis. Every experiment
   increments its family's counter in hypotheses/ledger.md; findings must
   cite "test #N in family F".
10. **Numbers come from the harness.** No metric in a report or finding is
    authored by a human or an agent: every number is the output of a
    re-runnable script. Interpretation is yours; numbers are the code's.
11. **Post-cutoff windows.** If a hypothesis consumes a pretrained model's
    outputs (TSFM, LLM), prefer test windows AFTER that model's knowledge
    cutoff; overlap with its pretraining is declared as a limitation.

## Finding format (knowledge/*.md)

```markdown
---
id: YYYY-MM-DD-slug
type: WORKS | DOESNT_WORK | INSIGHT
confidence: low | medium | high
evidence:
  - research/reports/<report>.md
  - <commit sha / run id>
related: [ids]
---
One or two sentences of substance. Conditions of applicability. What changes.
```

## Queue format (hypotheses/queue.md)

One table. Statuses: QUEUED → TESTING → DONE | KILLED; BLOCKED = an unmet
prerequisite (named in the row). Source: HUMAN or AGENT (human entries take
priority by default). A hypothesis without a kill criterion is not accepted
into the queue.
