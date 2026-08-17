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
| Hands-free 3.79 | Evolve tick, resume locks, CP prune, path-bind grounding, `goal --harness`, HB handler refresh, offline fixtures, `SELF_EVOLUTION.md` |

## P0 — next product value

1. **Channel-delivered heartbeat** — **done**  
   Fixed `deliverToChannel` arg order; silence skip; Telegram/Discord/Slack; docs in AUTONOMY.md.

2. **OS sandbox default on prod** — **done**  
   Prod `osSandbox: auto`; `enforceProdHardening` forces `off`→`auto`; doctor probes `works=true|false`.

3. **Eval regression as release gate** — **done**  
   `test/long-horizon-fixtures.test.mjs` (hello workspace + abs verify + checkpoint) in eval-regression + CI.

4. **Computer-use depth** — **done**  
   Structure snapshot: set-of-marks + bbox click coords; `browser_observe` hybrid with optional `include_pixels`.

5. **Durable browser profile** — **done**  
   Default vault `~/.xclaw/browser-profiles/default`; opt-out `XCLAW_BROWSER_EPHEMERAL=1`; doctor no longer warns when using default.

## P1 — hardening

- Swarm absolute-path goals outside git: optional “host workspace” mode without worktree when goal paths are absolute. — **done** (`shouldUseHostWorkspace`, `XCLAW_SWARM_HOST_WORKSPACE`)
- Gateway doctor version string drift (`0.6.1` vs package `3.76.x`). — **done** (reads `package.json`)
- Rotate any keys/PATs that appeared in chat; prefer env-only secrets. — **operator action** (not code)

## P2 — research / stretch

- WildClaw-style long-horizon suite (subset) as optional nightly workflow. — **done** (`.github/workflows/nightly-long-horizon.yml`)
- MCP skill surface parity checklist vs OpenClaw-class tools. — **done** (`docs/MCP-PARITY.md`)
- Self-evolution: skill learning already partial — needs owner-gated writeback policy in prod. — **done** (`canInstallSkills`, prod blocks install unless ownerApproved / allowInstall / env)

## How to pick “next”

| If you want… | Start with |
|--------------|------------|
| Unattended goals + recovery | [SELF_EVOLUTION.md](./SELF_EVOLUTION.md) · `xclaw goal` · `evolve tick` |
| Long grounded runs | [HARNESS.md](./HARNESS.md) · path-binding claims |
| Channel alerts while idle | Heartbeat delivery (done) + `autonomy.heartbeat.delivery` |
| Stronger prod bash isolation | OS sandbox / bwrap (done) |
| GUI / computer-use depth | Hybrid observe (done) · deeper native drivers still open |

## Open (post-3.79)

- Live multi-hour soak of gateway + heartbeat + goal queue
- Approval timeout clear on `decide` (timer hygiene)
- Cross-process resume lock (file lock), not only in-process
- Optional auto-resume of **failed** finals (`evolve.resumeFailed`)
- Deeper computer-use native drivers (Win/mac) beyond current stubs

## Release cut

**Stable tag: [v3.79.0](https://github.com/Matrixx0070/xclaw/releases/tag/v3.79.0)** (hands-free evolve)

```bash
git checkout v3.79.0
npm run smoke:arc
node bin/xclaw.mjs doctor
node --test test/self-evolve.test.mjs
```

`main` may include post-tag fixes (e.g. heartbeat `cron:after` once-only bind).

### Operator before production

1. Rotate any secrets that appeared in chat
2. `XCLAW_PROFILE=prod` + `XCLAW_GATEWAY_TOKEN`
3. Read [SECURITY.md](../SECURITY.md)
