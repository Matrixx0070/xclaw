# ADR 0002 — Swarm and self-evolution are live gated capabilities (keep)

- **Status:** Accepted (2026-08-24)
- **Relates to:** the W4b line item "swarm / self-evolution flag fate" in the
  30-day audit plan; complements [ADR 0001](0001-missions-vs-objectives.md).

## Problem

W4b asked whether the swarm and self-evolution flags were experimental or dormant
surfaces to consolidate or remove during the orchestrator-cleanup pass.

## Findings (verified 2026-08-24)

### Swarm — live, default-on, approval-gated
- `defaults.mjs:314` `swarm.enabled: true`; dependency-aware
  (`dependsOn`/waves/vote/merge), `mergeEnabled: true` with prod leaving patches
  `pending_approval` (comment at defaults.mjs).
- Live HTTP surface `src/gateway/routes/swarm.mjs`: `GET /swarm/merges`,
  `POST /swarm/merges/:id/approve|reject`, `GET /swarm/merges/:id`,
  `GET /swarm/:id`; `POST /swarm/run` + `/swarm/run/stream` remain in index.mjs.
- Consumed as `strategy:"swarm"` by the missions engine
  (`routes/point.mjs:144` → `engine.startMission`).
- **Verdict:** production capability with a safe (approval-gated) default. Not a dead flag.

### Self-evolution — live, conservatively gated, dormant-by-default
- `defaults.mjs:391` `autonomy.level: "lab"`, but `autonomy.heartbeat.enabled:
  false` — so the unattended evolution tick (`cron/heartbeat.mjs:119`
  `runEvolutionTick`) does **not** fire by default; an operator must enable the
  heartbeat first.
- Reachable via the `xclaw evolve status|tick|overlay [--dry-run] [--promote]
  [--owner-approved]` CLI (`bin/xclaw.mjs:2673`) and `doctor` status
  (`cli/doctor.mjs:1062`).
- Self-gates in `src/autonomy/self-evolve.mjs` via `resolveAutonomyLevel`:
  `level:"off"` → blocked; auto-promote only under `lab`/`full` behind the skill
  install gate; prod proposals stay review-only unless `ownerApproved`.
- **Verdict:** live but off-or-approval by default; effectively dormant until an
  operator opts in. Not a dead flag.

## Decision

**Keep both.** Neither swarm nor self-evolution is an experimental/dead flag to
remove. No consolidation or deletion; the audit's "flag fate" question resolves to
"live, keep, already safely gated."

## Tradeoffs

Two autonomy surfaces (swarm fan-out, self-evolution) coexist alongside the
mission/objective engines. Accepted: each is independently gated and defaults to
off or approval-required, so the surface area carries no unattended-action risk in
its default config.

## Consequences

- W4b documentation deliverable is satisfied by this record.
- Any future consolidation MUST preserve these gates and capabilities
  (never-drop-capabilities).
- No code change lands from W4b; defaults already encode the safe posture.
