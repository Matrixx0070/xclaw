# Webhook on live-report ok=false

## Goal

POST `.xclaw-evidence/last-live-report.json` when `ok` is false.

## Design

- Env: `XCLAW_LIVE_REPORT_WEBHOOK`
- Body: `{ok, ids, usedUsd, turns, at}` — no keys
- Fire from `horizon-live-g10-g14.sh` after confirm-live

## Local today

- Wrapper + $2 cap + confirm flag
