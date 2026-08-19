# HTTPS/S3 SIEM sink

## Goal

Deliver signed bundles off-box.

## Design

- `XCLAW_AUDIT_SINK=https|s3|file`
- HTTPS POST bundle JSON
- S3 put `audit/{account}/{to}.json`

## Local today

- File cursor + signed header
