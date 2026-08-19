# Multi-agent cost governor shared ledger

## Problem

Swarm children must not each see a full daily budget; the parent/day ledger is shared.

## Design

1. **Ledger key**: `day + account` (not per-job).
2. **Reserve on spawn**: parent reserves estimated USD for each child before start.
3. **Settle on finish**: child actual usage adjusts reservation; overspend trips hard block on parent.
4. **Circuit**: any child hard-block increments parent `hardBlocks`; swarm eval ceiling applies.

## Entry points

- Existing: `src/tokens/cost-governor.mjs`, `src/seats/manager.mjs`
- New: parent `runJob({ swarmId })` + `swarm-receipt.mjs`
- Eval: `scoreSwarm` hardBlockRate <= 0.25

## Non-goals

- Separate per-agent unlimited budgets
- Bypassing prod hard cap via parallel children
