# NATS/Redis generation pubsub

## Goal

Transport for GENERATION_GOSSIP across regions.

## NATS

- Subject: `xclaw.generation.{account}`
- Payload: `{ generation, owner, region, at }`
- Followers: `mergeGossip` on message

## Redis

- Channel: `xclaw:generation:{account}`

## Local today

- File watermark `src/cluster/gossip-watermark.mjs`
