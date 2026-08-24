# ADR 0003 — swarm-ext: vendored second swarm engine as an isolated opt-in module

Date: 2026-08-24 · Status: accepted · Relates to: ADR 0002 (does NOT supersede it)

## Problem

The operator delivered a complete external swarm extension
(`xclaw-swarm-extension-xclaw-branded.zip`, 104 files) with the instruction to
implement it into the xclaw codebase. It is a full parallel orchestration
engine (LLM goal decomposition → DAG cycle-breaking → up to 300 Redis-queued
sub-agents → llm/vote/quorum/concat merge → receipts → PARL reward samples).
It collides with the existing system three ways: it ships a file at the exact
path of the live `src/gateway/routes/swarm.mjs`; it requires 11 declared npm
deps against a deliberately zero-dependency core; and it duplicates the native
swarm that ADR 0002 (same day) resolved to keep.

## Alternatives

1. **Replace the native swarm** — overwrites live routes on a public repo,
   violates ADR 0002's never-drop-capabilities rule, and the vendor LLM
   interface doesn't match `createProvider` (would not run without rework).
2. **Cherry-pick capabilities** into `src/agents/swarm-*` — highest quality
   long-term but discards most of the delivered work and was not what the
   operator asked for.
3. **Isolated opt-in module** (chosen) — vendor the whole tree at
   `src/swarm-ext/`, OFF by default, own nested `package.json` for its 3 real
   deps, mounted at `/api/swarm` only when `swarmExt.enabled`, glued to
   xclaw's provider by a dependency-free adapter.

## Decision

Option 3, confirmed by the operator. Boundary rules:

- `src/swarm-ext/` is the ONLY home of the extension; nothing under it is
  imported unless `cfg.swarmExt.enabled` (single gate in `src/gateway/index.mjs`).
- The native swarm (`src/agents/swarm-*.mjs`, `/swarm/*` routes, missions
  `strategy:"swarm"`) remains the primary engine and is byte-untouched.
- Root `package.json` stays zero-dependency; extension deps install via
  `npm install --prefix src/swarm-ext` (express, ioredis, zod — the only three
  actually imported; the zip declared 8 more that no file uses).
- `/api/swarm` is operator-token protected in both auth modes.
- Glue code (`llm-adapter.mjs`, `mount.mjs`) is dependency-free / lazily
  importing, unit-tested in the main suite; vendor tests run via
  `npm test --prefix src/swarm-ext`.

## Tradeoffs

Two swarm engines coexist (accepted duplication; ADR 0002 explicitly permits
coexistence and forbids capability drops). The extension's plugin tools are
partly stubs and its docker sandbox is config-only — documented in
`src/swarm-ext/README.md`, shipped honestly rather than silently "fixed".

## Consequences

Default behavior is bit-identical (flag off → `/api/swarm` 404s, module never
imported). Any future consolidation of the two engines must preserve the gates
listed in ADR 0002 plus this module's receipt/PARL/DAG capabilities, and gets
its own ADR.
