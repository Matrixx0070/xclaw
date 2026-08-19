# Redis compact lease backend

## Goal

Shared compact lease across hosts (`XCLAW_COMPACT_LEASE_BACKEND=redis`).

## Design

- SET compact:{region} owner NX PX 15000
- Renew only if GET == owner
- Release DEL if owner

## Local today

- File lease + drain skip when held
