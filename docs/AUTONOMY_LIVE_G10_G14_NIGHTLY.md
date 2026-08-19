# Live G10–G14 nightly under $2 cap

## Goal

One `--confirm-live` pack (G10–G14 only) with `XCLAW_SOAK_MAX_USD=2`.

## Design

- Cron after scorecard: `horizon-cli --live --confirm-live --soak-job nightly`
- Writes `.xclaw-evidence/last-live-report.json`
- `--all` is opt-in; default ids stay G10–G14

## Local today

- Report writer + dry-run does not write
