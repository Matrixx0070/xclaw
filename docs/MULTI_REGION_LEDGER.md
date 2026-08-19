# Multi-region ledger sync (1 year ahead)

## Goal

Shared daily hard cap across gateway regions without double-spend.

## Design sketch

1. **Primary writer**: one region holds lease on `day+account` ledger
2. **Replicas**: read-only snapshots with TTL; reserve requires primary ack
3. **Conflict**: last-writer-wins on settle with monotonic `entrySeq`
4. **Fail closed**: if primary unreachable, refuse new reserves (allow settle)

## Local today

- Single-node `src/tokens/swarm-ledger.mjs` file ledger
- Hard cap before reserve

## Next

- Redis/etcd backend optional
- Cross-region canary on reserve latency
