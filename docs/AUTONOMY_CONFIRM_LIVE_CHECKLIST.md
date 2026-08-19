# First real `--confirm-live` checklist

1. `node src/eval/horizon-scorecard-cli.mjs` → `ok: true`
2. `bash scripts/horizon-live-g10-g14.sh` dry-run (no confirm)
3. Set `XCLAW_SOAK_MAX_USD=2` and `XCLAW_SOAK_CONFIRM=1`
4. Optional: `XCLAW_LIVE_REPORT_WEBHOOK`
5. Run wrapper; inspect `.xclaw-evidence/last-live-report.json`
6. Stop if canary fail or usedUsd hits cap
