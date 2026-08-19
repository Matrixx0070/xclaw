# Signed compact audit (HMAC)

## Goal

Tamper-evident audit: each line carries HMAC over the payload.

## Design

- `sig = HMAC-SHA256(XCLAW_AUDIT_HMAC_SECRET, stableStringify(event))`
- Verify on doctor / export

## Local today

- Append-only jsonl + 10MB rotate
