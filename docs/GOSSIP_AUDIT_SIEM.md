# Export signed audit bundle for SIEM

## Goal

Ship a verifiable audit snapshot to SIEM.

## Design

- Bundle: last N lines + HMAC over the concatenation
- Header `{ from, to, count, sig }`

## Local today

- Per-line HMAC + last-N verify
