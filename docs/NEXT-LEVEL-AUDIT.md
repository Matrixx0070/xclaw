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

## Roadmap — COMPLETE (2026-08-14, v3.102.0 → v3.106.0)

- ~~Local-plane fast file ops for worktree edits (latency)~~ **KILLED by
  measurement (v3.102.0)**: an instrumented live mission showed ALL tool calls
  (11 file ops + 4 bash) total 0.6s of a 260s wall; computer-plane file ops run
  in 5–20ms and do not queue behind in-flight bash. The wall-clock goes to
  model turns (~31%) and verification (npm install/test). The observed
  "1–2min/call" was model-turn latency, not the plane. What v3.102.0 shipped
  instead (the measured bottleneck + what measurement surfaced): mission tool
  scoping (113→~15 schemas/turn — also closes MCP/browser/image tools escaping
  the worktree-isolation story under mission autoApprove), untracked files in
  merge evidence, and verify-artifact merge exclusion. v3.102.1 closed the
  bugs live-verification surfaced: per-mission approval gate (the shared-gate
  singleton silently broke mission autonomy on live gateways), the
  tool_use/tool_result pairing invariant, and the resume-of-failed
  evidence-gate bypass.
- ~~Swarm-backed missions~~ **SHIPPED v3.103.0**: `strategy:"swarm"` — the
  plan emits a fenced task graph (or the caller provides one), execute fans
  out via the dependency-aware swarm inside the mission worktree, implement
  nodes early-merge back into the shadow workspace, evidence gate unchanged;
  degraded-to-solo on fan-out failure. Live-proven (model-authored 2-node
  graph, parallel execution, verified, merged).
- ~~Visual "point-and-prompt"~~ **SHIPPED v3.104.0**: CDP client primitive
  drives the operator's display browser, one-shot picker overlay captures the
  element, lexical resolver ranks its source locations, `/point/*` routes +
  Control-UI card launch a pinned mission. Live-proven (real click →
  `.hero-title` red→#0b57d0 → merged → computed style verified).
- ~~Remote/cloud workers~~ **SHIPPED v3.105.0**: mission federation — worker
  registry, validated URLs, start/track/diff/merge/rollback proxies over the
  worker's own token-gated API, Control-UI workers card + launch-target
  selector. Live-proven against a second gateway running a different model
  (ollama glm-5.2:cloud), remote merge landed on the worker repo.
- ~~Completion-aware code completion service~~ **SHIPPED v3.106.0**:
  repo-intel fill-in-the-middle (`POST /complete` + `xclaw complete`),
  buffer-first import resolution for new files. Live-proven via gateway and
  CLI.

### Post-roadmap candidates — ALL SHIPPED (2026-08-14, v3.107.0 → v3.110.0)

- ~~Phase-aware resume~~ **v3.107.0**: `executedAt` marker; failed/interrupted
  missions re-enter at planning | executing | verifying by actual progress;
  swarm missions resume their fan-out journal. Live-proven with a real
  mid-execute gateway kill → resume → merge.
- ~~Transactional merge~~ **v3.107.0**: patch --check before untracked copies,
  no silent overwrite of existing untracked files (identical content stays
  idempotent), copies rolled back on late patch failure.
- ~~Webchat point-and-prompt~~ **v3.108.0**: 🎯 composer button → picker →
  element descriptor + resolved sources dropped into the chat.
- ~~Worker bootstrap + TLS guidance~~ **v3.109.0**: `xclaw workers
  list|add|remove|ping|token|join-command` + docs/FEDERATION.md.
- ~~Editor integration~~ **v3.110.0**: `xclaw lsp` (stdio LSP over the
  completion service) + docs/COMPLETION.md.

This document's mandate (15-point audit → roadmap → post-roadmap) is fully
executed. Future work starts from fresh observations, not this list.

---

## Mandate-2 arc (v3.113.0 → v3.122.0, 2026-08-14)

Second-generation mandate: from autonomous engineering *platform* to *operating
system*. Ten slices, each a live-proven release; then an adversarial audit.

| Ver | Slice | What shipped |
|---|---|---|
| 3.113.0 | A1 | Operational ledger — durable black box; graph by joins over JSONL |
| 3.114.0 | B1 | Persistent repo intelligence — incremental index shared across worktrees, compounding brief |
| 3.115.0 | A2 | Zero-trust risk policy — facts→tier, durable pins, mission autonomy risk-bounded |
| 3.116.0 | A3 | Time-travel — commit-on-merge, refs/xclaw/*, revert, attribution |
| 3.117.0 | B3 | Economic routing — model metadata + measured stats + governor economy band |
| 3.118.0 | B5 | Mission Control live canvas — swarm WS producer + SVG DAG live-patch |
| 3.119.0 | B2 | Hierarchical context — LLM folds + fold-of-folds + mission phase carry |
| 3.120.0 | B4 | Swarm blackboard + dynamic roles + voteNodes + tournaments |
| 3.121.0 | A4 | Self-modification loop — self profile + autonomous deploy/health/rollback |
| 3.122.0 | audit | 2 BLOCKERs + 10 HIGH/MED closed by adversarial review |

Capstone proofs (live): first autonomous self-deploy (xclaw edited its own
repo, gated, merged, restarted itself, health-passed); fire-drill (broken
build → auto-rollback to known-good); tournament (N competitors → deterministic
verify judge → winner merges).

Pillar 8 (universal code intelligence) needed no new subsystem — language-
agnostic by construction. Not built (doctrine): graph DB, model-in-the-gate,
file-copy snapshots, embeddings/vector DB, message bus, bandit routers.
