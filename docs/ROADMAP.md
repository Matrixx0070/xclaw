# XClaw Roadmap

Honest scope: competitive production agent gateway. Not “one year ahead of the entire industry.”

## Done recently (ops / autonomy / fabric)

| Area | What landed |
|------|-------------|
| Realtime | Bounded queues, WS outbound, stream resume, doctor buffer checks |
| Agent live | Multi-step SSE, swarm DAG, `/tmp` isolate + plan cwd fixes |
| Jobs | Verify path resolution, checkpoint resume, queue + workspace |
| Autonomy | Levels `off\|supervised\|lab\|full`, heartbeat, env precedence |
| Prod safety | `enforceProdHardening` (no lab autoApprove leak), egress deny |
| Browser fabric | Tab leases, commit gates, role bind, `beforeNavigate` order |
| Docs / UX | `AUTONOMY.md`, `FABRIC.md`, status/info/doctor/CI/self-test |

## P0 — next product value

1. **Channel-delivered heartbeat**  
   Wire `autonomy.heartbeat.delivery` end-to-end for Telegram/Discord (owner notify on non-`HEARTBEAT_OK`).

2. **OS sandbox default on prod** — **done**  
   Prod `osSandbox: auto`; `enforceProdHardening` forces `off`→`auto`; doctor probes `works=true|false`.

3. **Eval regression as release gate**  
   Expand `scripts/eval-regression.mjs` with 1–2 long-horizon job fixtures (verify + checkpoint) so CI fails on agent-loop regressions, not only unit packs.

4. **Computer-use depth**  
   Hybrid observe (screenshot + a11y/DOM where available); reduce pure-coordinate fragility on dynamic UIs.

5. **Durable browser profile**  
   Document + default lab path for `XCLAW_BROWSER_PROFILE_DIR` so login sessions survive restarts (doctor `h0.profile` warn).

## P1 — hardening

- Swarm absolute-path goals outside git: optional “host workspace” mode without worktree when goal paths are absolute.
- Gateway doctor version string drift (`0.6.1` vs package `3.76.x`).
- Rotate any keys/PATs that appeared in chat; prefer env-only secrets.

## P2 — research / stretch

- WildClaw-style long-horizon suite (subset) as optional nightly workflow.
- MCP skill surface parity checklist vs OpenClaw-class tools.
- Self-evolution: skill learning already partial — needs owner-gated writeback policy in prod.

## How to pick “next”

| If you want… | Start with |
|--------------|------------|
| Owner pings while agent idles | P0.1 heartbeat delivery |
| Stronger prod bash isolation | P0.2 bwrap default |
| CI catches agent regressions | P0.3 eval fixtures |
| Better GUI agents | P0.4 computer-use |
| Sticky logins | P0.5 browser profile |

Say **P0.1** … **P0.5** (or another target) to execute.
