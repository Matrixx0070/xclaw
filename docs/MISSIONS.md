# XClaw Missions — Autonomous Engineering

A mission takes a high-level engineering objective and carries it through
**plan → change → verify → repair → prove**, with durable state, recovery, and
a shadow workspace so the repository is never left in an unknown state.

Core: `src/missions/engine.mjs` · state: `src/missions/store.mjs` · context:
`src/intel/repo-intel.mjs` · routes: `src/gateway/routes/missions.mjs` · UI:
Control → **Mission Control**.

## Lifecycle

```
planning → executing → verifying ⇄ repairing → merge_ready → (merge) → done
                                        │
                                 (maxAttempts) → failed
```

1. **Shadow workspace** — a git worktree is created off the target repo. ALL
   work happens there; the user's repo is untouched until an explicit merge.
   Rollback = discard the worktree.
2. **Plan** — `repo-intel` assembles task context (ranked files from lexical
   hits, symbol/path matches, import centrality, git change-frequency) and the
   agent produces an implementation plan — no code yet.
3. **Execute** — the agent implements the plan in the worktree with full
   autonomy *inside* layered boundaries: sandbox pinned to the worktree,
   egress guards, lifecycle hooks (a `pre_tool_use` system-hook deny still
   blocks — autonomy never bypasses the security stack).
4. **Verify** — the project's own checks run in the worktree (auto-detected:
   `npm run lint/build/test`, `pytest`, `go test`, `cargo test`; or configured
   `verify` commands). Node projects get `npm install` in the fresh worktree.
5. **Repair** — on failure, the failing command + output feed a bounded repair
   loop (`maxAttempts`, default 3). The agent is told to fix the root cause,
   not weaken tests.
6. **Prove + gate** — the diff is captured. A mission can **never** reach
   `merge_ready` without a recorded passing verification run — success is
   never claimed without evidence.
7. **Merge** (gated) — applies the verified worktree changes to the real repo.
8. **Rollback** — discards the worktree; the repo was never touched.

## Durability & recovery

- Every phase transition is persisted atomically (tmp + rename) to
  `<configDir>/missions/<id>.json`.
- On gateway boot, any mission left in an active status by a crash/restart is
  marked **interrupted** (resumable) — never silently lost.
- `resumeMission()` continues from the recorded phase in the surviving
  worktree; if the worktree vanished (reboot tmpdir cleanup) it recreates it
  and re-runs from plan, keeping the mission's history and attempt count.
- Terminal statuses (`done`, `rolled_back`) are protected: a late/aborted
  handler can never overwrite them (see the terminal-status guard and the
  `bailIfAborted` phase-boundary checks).

## API

```
GET    /missions                 list (status, progress, running)
POST   /missions                 {goal, repoDir, autoMerge?, maxAttempts?, verify?}
GET    /missions/:id             full record (plan, verify evidence, events)
GET    /missions/:id/diff        the captured patch
POST   /missions/:id/resume      resume interrupted/failed
POST   /missions/:id/merge       {checkOnly?} apply verified changes (gated)
POST   /missions/:id/rollback    discard the workspace (repo untouched)
```

All routes are token-gated in both auth modes (missions run autonomous agents
against repositories). Mission phase events broadcast on the WS `mission`
channel; Mission Control renders progress, evidence, timeline, and diff, with
Merge / Resume / Rollback / View-diff controls.

## Config (`xclaw.json` → `missions`)

```jsonc
{
  "missions": {
    "maxAttempts": 3,            // repair-loop bound
    "maxTurnsPerPhase": 20,      // agent turns per plan/execute/repair phase
    "models": {                  // optional per-phase model routing
      "plan": "claude-opus-5",
      "execute": "claude-sonnet-5",
      "repair": "claude-sonnet-5"
    }
  }
}
```

## The guarantee

XClaw never reports a mission complete without evidence: `merge_ready` requires
a passing verification run recorded in the mission, and the user's repository
stays byte-for-byte untouched until they (or `autoMerge`) apply the gated
merge. If verification can't pass, the mission fails honestly with the failing
command output attached — it does not claim success.
