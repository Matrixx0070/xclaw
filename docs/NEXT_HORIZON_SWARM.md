# Next horizon: multi-agent swarm receipts + seat OAuth

Post n10 kill-switch freeze (3.132.1 / `stopSurfaceFreeze: n10`).

## Goals (1 year ahead)

1. **Swarm receipts** — parent job aggregates child tool hashes, cost, and hard-block circuits.
2. **Seat OAuth** — Grok/xAI subscription seat tokens with refresh rotation and reuse detection.
3. **Shared durable memory** — fsynced job/checkpoint plane (durable-write) as the shared spine.
4. **Cross-agent stop** — single-port `/stop` aborts swarm tree with `lastDrain.channel` audit.
5. **Eval** — autonomy harness scores swarm completion without hardBlockRate ceiling breach.

## Non-goals (this horizon)

- Replacing single-port gateway
- Weakening HMAC/prod stop auth

## Entry points

- `src/jobs/durable-write.mjs`
- `src/eval/autonomy-cost-circuit.mjs`
- `scripts/tls-stop-smoke.mjs`
- Existing seat manager: `src/seats/manager.mjs`
