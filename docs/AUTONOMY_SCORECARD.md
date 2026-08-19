# Autonomy scorecard from soak + horizon

## Goal

One doctor view: pack pass, soak blocks, lease denials, SIEM HMAC, S3 sink.

## Design

- Composite: horizon pack 11/11 + soak policy + SIEM verify + last S3 key
- Fail-closed if HMAC fail > 0 in prod

## Local today

- Soak S3 idempotent sink with injectable client
