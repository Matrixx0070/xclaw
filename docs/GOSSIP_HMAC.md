# Signed gossip payloads (HMAC)

## Goal

Untrusted region transport must not inject a high generation.

## Design

```
payload = stableStringify({ generation, owner, region, at })
sig = HMAC-SHA256(XCLAW_GOSSIP_HMAC_SECRET, payload)
```

Reject if missing sig in prod or timing-safe compare fails.

## Local today

- In-process pubsub + max watermark
- Cluster HMAC on `/cluster/reserve` only
