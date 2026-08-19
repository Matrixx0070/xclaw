# Swarm ledger surface (API additions)

Extends kill-switch freeze (`stopSurfaceFreeze: n10`) with shared budget signals:

| Field | Where |
|-------|--------|
| `stop.swarmLedger.pressure` | `GET /health`, readiness |
| `stop.swarmLedger.spentUsd/reservedUsd/hardUsd` | health + doctor |
| `SWARM_LEDGER_HARD_CAP` | job deny `code` + `costBlocked` |
| `.xclaw-evidence/swarmLedger.json` | release-gate `--strict` |

Version note: document alongside 3.132.x freeze; no breaking stop routes.
