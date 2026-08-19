# S3 put + retry jitter

## Goal

Reliable off-box audit delivery.

## Design

- Put `audit/{account}/{to}.json`
- Decorrelated jitter retry
- Do not advance cursor until put succeeds

## Local today

- file/https/s3 selector + file write
