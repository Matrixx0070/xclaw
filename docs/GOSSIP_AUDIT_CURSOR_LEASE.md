# Cursor lease (no double-export)

## Goal

Two gateways must not export the same audit range.

## Design

- Lease `audit-cursor` TTL 15s
- Holder exports + puts + advances cursor

## Local today

- Rollback cursor if S3 put fails
