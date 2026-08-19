# NATS HMAC subscriber adapter

## Goal

Real transport for signed generation gossip.

## Flow

1. Publisher: `signGossip(payload)` → NATS `xclaw.generation.{account}`
2. Subscriber: `verifyGossip` then `mergeGossip`
3. Prod: unsigned / bad-sig increment `xclaw_gossip_reject_total`

## Local today

- In-process pubsub + HMAC sign/verify
