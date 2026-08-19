# Write first live soak report after a real run

## Goal

After the first successful `--confirm-live` G10–G14 under $2, archive:

- `.xclaw-evidence/last-live-report.json`
- `.xclaw-evidence/last-checklist.json`
- scorecard snapshot

## Checklist

1. `node scripts/horizon-confirm-checklist.mjs` (dry) → ok
2. `XCLAW_SOAK_CONFIRM=1 XCLAW_SOAK_MAX_USD=2 node scripts/horizon-confirm-checklist.mjs --spend`
3. Inspect `last-live-report.json` usedUsd / canary / ok
4. Copy into `reports/release/<stamp>/` via evidence pack

## Local today

- Checklist runner dual-gate (`--spend` + confirm)
