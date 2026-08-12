# Phase 5 — Ops freeze / release gate

Formal LTS checklist before shipping a 2.5.x patch.

## Commands

```bash
# Fast (CI / pre-push)
npm run release-gate:quick
# or
xclaw release-gate --quick

# Full local gate
npm run release-gate

# Strict (requires soak evidence)
npm run release-gate:strict
REQUIRE_SOAK=1 npm run evidence
```

## Checklist

| Step | Required (full) | Required (quick) |
|------|-----------------|------------------|
| `npm test` | yes | yes |
| `xclaw security-audit` | yes | yes |
| `npm run sandbox-redteam` | yes | no |
| `npm run fire-drill` | yes | no |
| `npm run evidence` | if `--strict` | no |

Report: `eval/baselines/release-gate-latest.json`

## Unfreeze to 2.6+

Only after:

1. Green `release-gate:strict`
2. `SOAK_MIN_NIGHTS≥3` soak summary
3. Explicit CHANGELOG unfreeze note

See [LTS.md](./LTS.md).
