# Shard seq ledger by region

## Goal

Bound single-file GC as region count grows.

## Design

- `gossip-seq.{region}.json` instead of one file
- Compact per shard
- Metrics labeled `{region=}`

## Local today

- Single `gossip-seq.json` + bloom persist
