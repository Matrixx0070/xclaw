# Multi-secret gossip rotation

## Goal

Rotate `XCLAW_GOSSIP_HMAC_SECRET` without dropping in-flight messages.

## Design

- `cfg.cluster.gossipHmacSecrets` = `[current, previous]`
- Sign with current; verify current then previous
- After TTL, drop previous

## Local today

- Single secret + replay window + reject reasons
