# S3 idempotent soak-audit sink

## Goal

Export signed soak SIEM bundles to S3 with idempotent keys.

## Design

- Key: `soak/{from}-{to}-{sha256}`
- Cursor lease before upload
- Retry + metric on sink fail

## Local today

- Local JSONL + HMAC + bundle header + cursor lease
