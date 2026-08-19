# Redis/etcd lease backend (1 year ahead)

## Goal

Replace file-based `swarm-ledger.lease` with distributed primary election.

## Interface (stable)

```js
acquireLease(cfg, { owner, ttlMs }) → { ok, owner, expiresAt, reason? }
renewLease(cfg, { owner, ttlMs }) → { ok, expiresAt }
releaseLease(cfg, { owner }) → { ok }
```

## Redis sketch

- Key: `xclaw:ledger:lease:{account}:{day}`
- `SET key owner NX PX ttl`
- Renew: `GET` + compare owner + `PEXPIRE`
- Fail closed on connection error when `XCLAW_LEDGER_LEASE=1`

## Local today

- `src/tokens/ledger-lease.mjs` file lock
- `XCLAW_LEDGER_LEASE=1` or `cfg.tokens.ledgerLease` gates `reserveUsd`
