# Soak SIEM export of resume events

## Goal

Append-only signed export of soak resume / lease events for audit.

## Design

- Event types: resume, lease_acquired, lease_denied, soak_blocked
- Bundle with HMAC like gossip audit SIEM
- Cursor for incremental export

## Local today

- File + Redis soak lease backends
