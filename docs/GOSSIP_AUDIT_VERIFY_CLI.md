# Offline audit verify CLI

## Goal

Forensics: verify HMAC lines + SIEM header without a running gateway.

## Design

- `xclaw audit verify --file compact-audit.jsonl --secret $SECRET`
- `xclaw audit verify-bundle --file audit-N.json`
- Exit non-zero on any fail

## Local today

- Idempotent S3 keys + per-line HMAC
