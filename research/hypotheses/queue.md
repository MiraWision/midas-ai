# Hypothesis queue

Statuses: QUEUED → TESTING → DONE | KILLED; BLOCKED = unmet prerequisite
(named in the row). Source: HUMAN / AGENT. A hypothesis without a kill
criterion is not accepted. Per-family test counts: [ledger.md](ledger.md).

| id | status | source | hypothesis | plan / kill criterion | result |
|---|---|---|---|---|---|
| sma-cross-example | QUEUED | HUMAN | SMA(12/48) crossovers on 1h USDC pairs carry net-positive 24h forward returns | [examples/hypotheses/sma-cross-example.md](../../examples/hypotheses/sma-cross-example.md) — 2 kill criteria there | — |
