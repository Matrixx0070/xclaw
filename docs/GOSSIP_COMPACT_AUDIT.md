# Compact audit log

## Goal

Forensics: who compacted which shard at which fence.

## Design

- Append-only `compact-audit.jsonl`
- `{ at, region, owner, fence, compacted, dropped }`

## Local today

- CAS shard write with fence
