# Compacted seq snapshot + GC old owners

## Goal

Bound `gossip-seq.json` size as owners churn.

## Design

- Keep last N owners by `at` (default 10k)
- Compact on write if owners > 2N
- Snapshot to `gossip-seq.json.bak` before compact

## Local today

- Per-owner seq + bloom nonce
