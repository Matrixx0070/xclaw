# Async shard compaction worker

## Goal

Move `compactSeqLedger` off the verify hot path.

## Design

- Queue `{region}` after accept
- Worker interval 1s / after N accepts
- Verify only writes last seq

## Local today

- Per-region shard files + sync compact
