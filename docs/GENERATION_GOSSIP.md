# Multi-region coordinator + generation gossip

## Goal

Share fence generation across regions so followers reject stale primaries after partition.

## Sketch

1. Each region has a local coordinator (etcd election or file lease)
2. On `bumpGeneration`, publish `{generation, owner, region, at}` to gossip topic
3. Followers keep `max(local, gossip)` watermark
4. Reserve responses include generation; reject if `< watermark`

## Local today

- File generation + `acceptGeneration`
- etcd campaign skeleton
- `claimOnBoot` / `claimOnBootAsync`
