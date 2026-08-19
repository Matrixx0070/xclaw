# Persist bloom snapshot across restart

## Goal

In-memory bloom is lossy on process restart.

## Design

- Snapshot `{gen, count, a, b}` as base64 to `gossip-bloom.bin`
- Load on boot; fail closed if corrupt
- Periodic fsync every N adds

## Local today

- In-memory sliding bloom + seq GC
