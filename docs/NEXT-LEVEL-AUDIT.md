# XClaw → Autonomous Engineering System — Architecture Audit & Roadmap

Audit of the existing codebase against the 15-point mandate, and the plan that
drove the first increment (v3.101.0, mission engine). This is a living doc; the
"built" column advances per release.

## 1. What we already have (reused, not rebuilt)

| Capability | Existing module | Reused for |
|---|---|---|
| Isolated git worktrees + merge/diff/cleanup | `agents/worktree.mjs` | shadow workspace, rollback |
| Subagent spawn + registry + persistence | `agents/spawn.mjs` | parallel workers (existing) |
| Dependency-aware swarm (dependsOn, waves, vote, merge) | `agents/swarm-run.mjs` + `swarm-*` | orchestration (existing) |
| Job checkpoints + resume + failure classify | `jobs/checkpoint.mjs` | recovery patterns |
| Objective verify checks | `jobs/verify.mjs` | verification primitives |
| Approval gate (allowlist, plan-bind, TOCTOU, SLA) | `security/approvals.mjs` | permission boundaries |
| Sandbox + egress guards | `security/*` | autonomy boundaries |
| Lifecycle hooks (8 categories, tiers, command hooks) | `hooks/*` | tool-phase governance |
| Tool router (local/computer/search/mcp planes) | `tools/router.mjs` | dynamic tool dispatch |
| Provider registry + routing + failover | `providers/*` | model abstraction |
| Cost ledger, eviction, token accounting | `tokens/*` | observability |
| Gateway + WS hub + Control UI | `gateway/*`, `ui/control/*` | Mission Control surface |

**Finding:** the autonomous *substrate* was strong. The gap was an orchestration
layer that turns a high-level objective into a durable, evidence-gated,
recoverable engineering run — not new low-level primitives.

## 2. What was missing

- A **mission** abstraction: durable state machine over plan→verify→repair.
- **Codebase intelligence** that assembles the *right* context (not RAG dump).
- A **shadow-workspace verification loop** with evidence gating.
- **Mission Control** for multi-mission visibility + gated merge.
- Boot-time **recovery** of interrupted long-running work.
- A hook-origin signal on approvals (carried-over weakest point).

## 3. What was reused vs 4. redesigned

- **Reused wholesale:** worktree lifecycle, approval gate, sandbox/egress,
  hook system, provider routing, WS/UI patterns.
- **Redesigned:** nothing ripped out. The mission engine *composes* existing
  primitives; `runAgentLoop` gained clean `provider`/`hookManager` injection
  seams (also unblocked hermetic loop tests) rather than being forked.

## 5. Built first (v3.101.0)

The reliability spine — because autonomy without recovery + evidence is a demo,
not a system:

1. `intel/repo-intel.mjs` — structure + symbols + imports + lexical + git-heat
   context assembly.
2. `missions/store.mjs` — atomic durable state, boot reconciliation, terminal
   guards.
3. `missions/engine.mjs` — plan→execute→verify→repair→merge_ready→merge/rollback
   in a shadow worktree, evidence-gated.
4. `gateway/routes/missions.mjs` + Mission Control UI.
5. Approval hook-origin badge (carried-over weakest point).

**Live-proven:** a real model fixed a real bug in a real repo through the UI —
planned, edited in a shadow worktree, verified with the project's own
`npm test`, and merged only after the check passed; the repo was byte-identical
until the human clicked Merge. A rollback race (terminal status clobbered by an
aborted run) was found and fixed with a regression test.

## 6. Architectural decisions that matter long-term

- **Core owns intelligence; frontends are clients.** Missions live in the
  gateway core, driven identically from UI, API, CLI, or an autonomous trigger.
  No frontend coupling.
- **Shadow workspace = isolation + rollback in one primitive.** The worktree is
  both the sandbox and the undo. The repo is the source of truth, never a
  half-mutated intermediate.
- **Evidence gate is structural, not advisory.** `merge_ready` is unreachable
  without a recorded passing verification — "never claim success without
  evidence" is enforced by the state machine, not prompt discipline.
- **Autonomy composes with, never bypasses, the security stack.** Mission
  agents run auto-approve *inside* the worktree, but hooks/sandbox/egress still
  apply and the merge to the real repo stays gated.

## 7. Bottlenecks / failure points (tracked)

- **Execute latency:** file edits route through the computer plane (~1–2 min/
  tool call observed live). Fine for correctness; a local-plane fast path for
  worktree file ops is the top follow-up.
- **Verification cost:** `npm install` per fresh worktree. Cache/reuse is a
  future optimization.
- **In-process tier caps** (hooks) are API-level, not OS-level; command hooks
  (out-of-process) are the isolation path. Remote/cloud workers (mandate #12)
  are the next isolation tier.
- **Single-agent missions today.** The dependency-aware swarm exists; wiring it
  as a mission execution strategy (architecture/backend/frontend/test agents
  under one mission) is the next orchestration increment.

## Roadmap (next increments)

- ~~Local-plane fast file ops for worktree edits (latency)~~ **KILLED by
  measurement (v3.102.0)**: an instrumented live mission showed ALL tool calls
  (11 file ops + 4 bash) total 0.6s of a 260s wall; computer-plane file ops run
  in 5–20ms and do not queue behind in-flight bash. The wall-clock goes to
  model turns (~31%) and verification (npm install/test). The observed
  "1–2min/call" was model-turn latency, not the plane. What v3.102.0 shipped
  instead (the measured bottleneck + what measurement surfaced): mission tool
  scoping (113→~15 schemas/turn — also closes MCP/browser/image tools escaping
  the worktree-isolation story under mission autoApprove), untracked files in
  merge evidence, and verify-artifact merge exclusion.
- Swarm-backed missions (parallel specialized agents under one mission +
  dependency-aware merge).
- Visual "point-and-prompt" (element → source → change → rebuild → verify).
- Remote/cloud workers as a mission execution target.
- Completion-aware code completion service.
