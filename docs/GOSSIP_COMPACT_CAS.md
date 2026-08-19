# Compare-and-swap compact write

## Goal

Persist fence on the shard file so a stale compact cannot overwrite a newer snapshot.

## Design

- Shard JSON includes `fence`
- Write only if disk fence <= holder fence

## Local today

- Monotonic fence file + acceptFence on compact
