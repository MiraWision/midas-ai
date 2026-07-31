# MidasAI

**An honest research environment for algorithmic trading.**

Pre-registered experiments. Permutation-tested claims. In-sample / out-of-sample
discipline. An AI research agent that runs on rails — not vibes.

> The uncomfortable truth of quant research: most trading ideas are noise, and
> most tooling is built to hide that. The most-starred "AI trading" projects on
> GitHub ship multi-agent debates and zero statistical validation — backtests
> inside the LLM's training window, no transaction costs, no controls. MidasAI
> is built as the antidote: a research loop whose survivors you can believe,
> because everything it produces had a pre-registered chance to die.

## What this is

MidasAI is a self-hosted platform for **testing trading hypotheses honestly**,
and — only if they survive — taking them to paper trading and beyond. You bring
the ideas, your own exchange keys, and optionally your own AI agent. The
platform brings the rails:

- **Event-study harness** — the statistical core. Any "this signal has edge"
  claim is tested against a random-timing permutation null (so market drift
  can't masquerade as alpha), and any "this feature matters" claim against a
  feature-shuffle null. Returns are net of costs. Deterministic under a fixed
  seed. ([`src/core/research/event-study.ts`](src/core/research/event-study.ts))
- **Methodology as law** — a research workspace template with pre-registration
  of kill criteria, a hypothesis queue, a knowledge journal, and a test-count
  ledger for honest multiple-comparisons accounting.
  ([`research/README.md`](research/README.md))
- **Strategy contract** — strategies are pluggable modules with a pure,
  lookahead-free `analyze()` surface. The engine doesn't care what your idea
  is; it cares that it's testable. ([`src/core/strategy/types.ts`](src/core/strategy/types.ts))
- **Exchange connectors** — market data behind a thin adapter interface.
  Kraken (USDC spot) ships first; adapters are ~200 lines to add.
- **Agent on rails** *(roadmap)* — run a coding agent (e.g. Claude Code) as an
  autonomous researcher with scoped write permissions, a budget, and the
  methodology enforced by prompt *and* by permission profile. The agent
  executes experiments and documents results; the statistics decide.
- **Sandbox first** *(roadmap)* — paper trading against a live feed, no keys
  required. Live trading is a deliberate, opt-in, bring-your-own-keys step —
  never a default.

## The methodology

Every experiment passes through these gates or it doesn't count:

1. **Kill criteria are fixed before the experiment.** Moving goalposts after
   seeing data invalidates the run.
2. **Permutation nulls, not eyeballs.** Edge claims beat random timing or they
   don't exist.
3. **Costs always.** All returns are net of round-trip friction; shorts cost
   more. Include a cost-sensitivity pass.
4. **IS/OOS split is mandatory.** A feature that flips sign between halves is
   noise, whatever its p-value.
5. **Multiple comparisons are counted.** The ledger tracks how many tests each
   hypothesis family has consumed; findings cite "test #N in family F".
6. **Negative results are results.** They're recorded with the same care.
7. **Two-stage gate.** Cheap signal-level tests must pass pre-registered
   thresholds before any expensive walk-forward backtest runs.
8. **Code implements the registered hypothesis.** Changing the hypothesis
   mid-run means registering a new one.
9. **Agents never author numbers.** Every metric in a finding comes from
   re-runnable script output.
10. **Pretrained-model hypotheses prefer post-cutoff windows.** Overlap with a
    model's training data is declared as a limitation.

## Quickstart

```bash
git clone https://github.com/MiraWision/midas-ai.git
cd midas-ai
cp .env.example .env
docker compose up -d db     # local Postgres
pnpm install
pnpm test                   # the statistical core, verified
pnpm dev                    # http://localhost:3000
```

See [`docs/self-hosting.md`](docs/self-hosting.md) for the full setup. Your
strategies live in [`src/strategies/`](src/strategies/) (an SMA-cross reference
module ships there); [`examples/`](examples/) holds a worked hypothesis
pre-registration to copy.

## Status

Early. This is the **foundation release**: the statistical harness (tested),
the core contracts (strategy / exchange / agent), the methodology workspace,
and the app shell. Market-data ingestion, the sandbox engine, and the agent
runner are being ported next — see the [roadmap issues](https://github.com/MiraWision/midas-ai/issues).

## Safety & disclaimer

MidasAI is research software, not financial advice. Nothing here recommends
buying or selling anything. Live trading support is opt-in, self-hosted, uses
*your* keys under *your* responsibility, and should only ever run with API keys
that **cannot withdraw funds**. Expect strategies to fail — that is the
platform working as intended.

## Contributing

Contributions are welcome — especially exchange adapters, harness improvements,
and documentation. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first: PRs that
add "profitable strategies" without pre-registered validation will be declined
on principle.

## License

[MIT](LICENSE) © MiraWision
