# ADR 0001 — Keep `src/missions/` distinct from `src/agent/objective.mjs`

- **Status:** Accepted (2026-08-24)
- **Supersedes:** the W4a line item "orchestrator consolidation — delete `src/missions/` after salvage" in the 30-day audit plan (artifact `762c8c9c-f14e-4def-a06d-1ef84e6fefa4`, see `docs/NEXT-LEVEL-AUDIT.md`).

## Problem

The deep architectural audit flagged "overlapping orchestrators" and W4a proposed
salvaging any shared code out of `src/missions/` and then deleting the directory,
on the reading that it duplicated the newer durable-segmented objective engine
(`src/agent/objective.mjs` + `src/agent/objective-store.mjs` +
`src/agent/objective-verify.mjs`, documented in `docs/LONGRUN.md`).

A static importer grep appeared to support this: `grep -rn "from ['\"].*missions/"`
returned **zero** hits, i.e. nothing statically imports the directory.

## What the investigation actually found

The static grep was blind. **Every** importer of `src/missions/` uses a *dynamic*
`await import("...missions/...")`, which no `from`-form grep can see. The live
call-sites are:

| Caller | Line | Uses |
|---|---|---|
| `src/gateway/routes/missions.mjs` | 49,50,85,96,123,134,157 | `store` + `engine` + `remote` — the `/missions` Mission Control API: list/create/`:id`/diff/resume/merge/rollback, `/missions/workers`, `/missions/remote` federation |
| `src/gateway/routes/point.mjs` | 143-160 | `engine.startMission()` — `/point` element-targeted missions, incl. `strategy:"swarm"` |
| `src/self/deploy.mjs` | 153-162 | `loadMission`/`saveMission`/`addEvent` via `markMission()` during self-deploy |
| `src/gateway/index.mjs` | 1003 | `reconcileInterrupted(cfg)` — boot crash-recovery of interrupted missions |

Critically, `objective-verify.mjs` and `objective-store.mjs` import **nothing**
from `missions/`. Missions and objectives are **distinct subsystems**, not two
implementations of one thing:

- **Missions** (`src/missions/`) — git-worktree-isolated *code* missions with
  worker federation, diff/merge/rollback, and remote worker fan-out
  (`docs/MISSIONS.md`, `docs/FEDERATION.md`).
- **Objectives** (`src/agent/objective*.mjs`) — general durable *segmented
  execution* of an arbitrary goal with fresh-context-per-segment, criteria-driven
  completion, and fail-closed verification (`docs/LONGRUN.md`).

They share a *conceptual* primitive ("resume an interrupted segment") but have
different domains, persistence layouts, isolation models, and completion
semantics.

## Alternatives considered

1. **Delete `missions/` after salvaging shared code into the objective engine.**
   Rejected — drops four live capabilities plus federation, and violates the
   standing "never drop working capabilities" rule.
2. **Merge both into a single orchestrator now.** Rejected as premature — the two
   have materially different lifecycles (worktree isolation + merge vs. in-place
   segmented turns), persistence, and completion criteria; forcing them together
   would add complexity, not remove it (doctrine rule 5).
3. **Keep both; optionally extract the shared segmented-resume primitive later,
   only if it net-reduces complexity.** Accepted.

## Decision

**Keep `src/missions/`.** Do not delete or fold it into the objective engine.
Correct the audit's "overlapping orchestrators / delete after salvage" premise:
the overlap is conceptual, not duplicative, and the directory backs four live
call-sites and the federation surface.

## Tradeoffs

Two subsystems that both "resume interrupted segmented work" coexist, which is a
small ongoing conceptual cost for a reader. Accepted because their problem domains
and mechanics differ enough that a single abstraction would leak.

## Consequences

- W4a is converted from a deletion task into this ADR (recommendation, per the
  never-drop-capabilities rule).
- `docs/NEXT-LEVEL-AUDIT.md` and `docs/RECON-2026-08-23.md` should note this
  correction where they reference orchestrator consolidation.
- A future *optional* slice may extract a shared `resumeInterruptedSegment`
  helper **iff** it demonstrably removes more complexity than it introduces;
  until then, both subsystems stand as-is.
- Auditing lesson (recorded for future passes): when checking whether a module is
  dead, grep for **both** static `from "…"` and dynamic `import("…")` forms — a
  `from`-only grep silently misses every lazy importer.
