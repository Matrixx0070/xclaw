# Gateway cluster lease coordinator

## Goal

Multi-GW election for shared swarm ledger beyond a single Redis key.

## Roles

- **Coordinator**: holds primary lease, serves reserve/settle
- **Followers**: proxy reserve to coordinator; local settle queue if partitioned
- **Witness**: optional third for quorum

## Failure modes

| Mode | Behavior |
|------|----------|
| Coordinator loss | TTL expiry → follower acquire |
| Split brain | Fail closed reserves until single owner |
| Redis down | `LEASE_BACKEND_ERROR` → readiness not ready in prod |

## Local today

- File lease + Redis skeleton + backend selector
- Metrics: `xclaw_lease_*` on `/metrics`
