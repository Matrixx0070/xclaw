# Raft/etcd coordinator election

## Goal

Replace static `XCLAW_COORDINATOR_URL` with elected primary.

## Options

1. **etcd election** — Session + Campaign
2. **Redis REDLOCK + generation** — matches current lease
3. **Raft** — full quorum

## Local today

- `bumpGeneration` fence + follower `acceptGeneration`
- Cluster auth + rate limit on `/cluster/reserve`
