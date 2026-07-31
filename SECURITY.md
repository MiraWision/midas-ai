# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/MiraWision/midas-ai/security/advisories/new)
for this repository. You'll get an acknowledgement within a few days.

## Scope notes for self-hosters

- MidasAI is self-hosted; **your exchange keys never leave your machine** and
  are read only from your local environment (`.env`). Never paste keys into
  issues, discussions, or logs you share.
- If you enable live trading, create exchange API keys **without withdrawal
  permission**. No feature of this project requires withdrawal rights, and no
  legitimate fork should ask for them.
- The optional AI-agent integration runs with scoped filesystem permissions by
  design. Do not widen its write access beyond the research workspace.
