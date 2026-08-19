# Live soak schedule (cron + cost cap)

## Goal

Nightly live horizon pack under hard USD and turn caps.

## Design

- Cron: `0 3 * * * xclaw eval horizon --live --confirm-live --all`
- Env: `XCLAW_SOAK_MAX_USD=2`, `XCLAW_SOAK_MAX_TURNS=8`
- Fail-closed if key missing or budget breached
- Offline pack remains CI default

## Local today

- Unified `apply-horizon-pack.mjs`
- `xclaw eval horizon --offline --all` (G10–G20)
- Live dry-run without `--confirm-live`
