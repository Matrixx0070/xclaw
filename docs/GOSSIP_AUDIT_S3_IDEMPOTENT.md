# Idempotent S3 keys (content hash)

## Goal

At-least-once retry must not create conflicting objects.

## Design

- Key `audit/{account}/{from}-{to}-{sha256(lines).slice(0,12)}.json`
- Same range + same lines → same key

## Local today

- Cursor lease + retry + rollback
