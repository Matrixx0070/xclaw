# Bloom-filter nonce cache

## Goal

Catch HMAC-only duplicate payloads inside the time window without storing every nonce.

## Design

- Optional `nonce` in signed payload
- Sliding bloom (2 generations) keyed by nonce
- False-positive: fail closed (reject) is acceptable for gossip
- Seq ledger remains source of truth for ordered owners

## Local today

- Per-owner seq + fsync ledger
