# ADR 0004 — Swarm unification: one subsystem, two engines, zero deps

Date: 2026-08-24 · Status: accepted · Supersedes the isolation contract of
[ADR 0003](0003-swarm-ext-isolated-module.md) (its never-drop-capabilities
core is preserved).

## Problem

After ADR 0003, xclaw ran TWO swarm engines: the native ensemble
(`src/agents/swarm-*.mjs`, `/swarm/run` — N parallel attempts on one task,
ballots/merge) and the vendored swarm-ext module (`src/swarm-ext/`,
`/api/swarm` — goal → DAG decomposition → parallel sub-agents → merge →
receipt), with separate route prefixes, config blocks (`swarmExt`), an
express sub-app, and external deps (express/ioredis; zod was dead on the
live path). The operator flagged the duplication: one responsibility, two
owners — exactly the class the RECON audit exists to remove.

## Alternatives

1. **Keep both isolated** — rejected: permanent duplication, permanent deps,
   permanent "which swarm?" confusion.
2. **Delete one engine** — rejected: they are complementary strategies
   (ensemble = redundancy/voting on ONE task; decompose = division of
   labor across DIFFERENT subtasks). Never-drop-capabilities applies.
3. **Unify: one subsystem, two strategies** — chosen.

## Decision

- `src/swarm/` is the single swarm home. The decompose engine's live core
  (34-file import graph traced from the mount) moved to
  `src/swarm/decompose/`; tool bridge, llm adapter, plugins came along.
  The native ensemble keeps its files (`src/agents/swarm-*.mjs`) and is the
  same subsystem's other strategy.
- **Zero external dependencies restored.** The redis-backed TaskQueue and
  MemoryStore were reimplemented in-process behind identical public
  interfaces (single-process gateway; a broker can return behind the same
  interface if multi-process swarm ever becomes real). The express layer
  was replaced by a native gateway route
  (`src/gateway/routes/swarm-goals.mjs`, `tryHandle` pattern — auth
  inherited from the gateway, dispatched before the native `/swarm/`
  catch-all).
- **One route surface**: `/swarm/run|run/stream|merges` (ensemble, unchanged)
  + `/swarm/goals`, `/swarm/tasks/:id[/cancel]`, `/swarm/decompose/health|
  stats|sessions` (decompose). Legacy `/api/swarm/*` aliases keep working.
- **One config home**: `swarm.decompose.*` (legacy `swarmExt.*` still
  honored). OFF by default, as before.
- Dead vendor code deleted (standalone entry, redis/zod carriers, unwired
  mcp-gateway chain, duplicate heartbeat class, fake `/batch` endpoint that
  fabricated task ids, stub `/receipts`). The formerly-dead `ToolPolicy`
  engine was instead WIRED LIVE: optional operator egress policy in the
  tool bridge (`swarm.decompose.tools.policy` — tool blocklist/allowlist,
  egress deny, URL host allowlist with the SSRF-safe suffix match).

## Tradeoffs

- In-process queue/store lose cross-process durability the vendor's redis
  gave in theory — in practice the gateway is one process and task state
  never survived restarts anyway (orchestrators map was already in-memory).
- Keeping `/api/swarm` aliases costs a small normalize shim; scheduled for
  removal after one deprecation cycle.

## Consequences

- `npm install --prefix src/swarm-ext` and redis are no longer needed;
  the whole repo is zero-dependency again.
- The decompose engine's tests run in the MAIN suite (they were vendor-local
  before and invisible to CI).
- Everything under `/swarm` is gateway-token-protected by one auth rule.
