# Live scorecard nightly cron

## Goal

Emit `xclaw_autonomy_scorecard_ok` after offline pack + soak dry-run.

## Design

- `0 4 * * * node src/eval/horizon-scorecard-cli.mjs`
- Fail-closed: HMAC fail or missing G-id → exit 1
- Live spend still requires --confirm-live separately

## Local today

- `buildAutonomyScorecard()` + CLI
