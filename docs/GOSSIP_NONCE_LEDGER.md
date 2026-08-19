# Gossip nonce / seq anti-replay ledger

## Goal

Stronger than time-window replay: reject reused `(owner, seq)` or nonce.

## Design

- Each publisher increments `seq` per region
- Payload: `{ generation, owner, region, at, seq, nonce }`
- Receiver stores last seq per owner; reject `seq <= last`

## Local today

- Time window `GOSSIP_REPLAY`
- Dual-secret rotation
