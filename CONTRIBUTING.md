# Contributing to MidasAI

Thanks for considering a contribution. This project has one non-negotiable
value: **statistical honesty**. The contribution rules below all follow from it.

## Ground rules

1. **No unvalidated edge claims.** PRs or issues claiming a strategy "works"
   must include a pre-registered experiment: hypothesis, kill criteria written
   *before* running, permutation-tested results net of costs, IS/OOS split.
   The workspace template in [`research/`](research/) shows the format.
   "Backtest went up" is not evidence.
2. **The harness is sacred.** Changes to `src/core/research/` need tests and a
   clear statistical rationale. If you weaken a null or a default, explain why
   in the PR — reviewers will push back by default.
3. **No secrets, ever.** No API keys, no `.env` files, no exchange account
   details — in code, tests, fixtures, or issue reports.
4. **Numbers come from code.** Documentation and findings must not contain
   metrics that can't be reproduced by a script in the repo.

## Good first contributions

- **Exchange adapters** — implement `MarketDataAdapter`
  (`src/core/exchange/types.ts`) for a new venue. Keep it thin: fetch, map,
  return; no venue-specific logic leaking upward.
- **Harness improvements** — better nulls, more efficient permutation loops,
  additional diagnostics (with tests).
- **Docs** — setup guides, methodology explainers, worked examples.
- **Example strategies** — pedagogical, clearly labeled as examples, with an
  honest validation writeup (negative results very welcome — they teach more).

## Development setup

```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm dev
```

Before opening a PR:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass; CI runs the same checks.

## Style

- TypeScript strict; no `any` where a type will do.
- Comments explain constraints the code can't show — not what the next line does.
- Keep modules pure and deterministic where the existing code is pure and
  deterministic (the harness is seed-stable by contract; don't break that).
- Conventional-ish commit subjects: `feat(scope): …`, `fix(scope): …`,
  `docs: …`, `research: …`.

## Proposing hypotheses

Trading-idea proposals are welcome as issues using the **hypothesis proposal**
template — but note the bar: an idea enters the queue only with a falsifiable
kill criterion attached. Ideas without one will be sent back for sharpening,
not silently dropped.

## Code of conduct

Be excellent to each other — see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
