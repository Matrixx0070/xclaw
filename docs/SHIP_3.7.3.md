# Ship 3.7.3 — Release checklist

**Version:** `3.7.3`  
**Theme:** S0–S3 swarm (durable agents → fan-out → DAG → safe merge)  
**Date:** fill on ship

---

## 0. Pre-ship (code freeze)

- [ ] `package.json` → `"version": "3.7.3"`
- [ ] `CHANGELOG.md` has **3.7.3** section (S3 safe merge)
- [ ] No uncommitted secrets (API keys, bot tokens) in tree
- [ ] `swarm.autoMerge` default **`false`** in `src/config/defaults.mjs`
- [ ] Docs present:
  - [ ] `docs/S0_SWARM.md` (or equivalent)
  - [ ] `docs/S1_SWARM_FANOUT.md`
  - [ ] `docs/S2_TASK_GRAPH.md`
  - [ ] `docs/S3_SAFE_MERGE.md`
  - [ ] `docs/S2_GRAPH_VIZ.md` (optional)

---

## 1. Automated tests

```bash
cd /path/to/xclaw
npm test
# or:
node --test test/**/*.test.mjs
```

Minimum suites for this ship:

| Suite | Path | Expect |
|-------|------|--------|
| Graph viz | `test/graph-viz.test.mjs` | PASS |
| S2 graph | `test/s2-swarm-graph.test.mjs` | PASS |
| S1 swarm | `test/s1-swarm-run.test.mjs` | PASS (if present) |
| S3 merge | `test/s3-swarm-merge.test.mjs` | PASS |
| S0 store | related swarm-store tests | PASS |

- [ ] All of the above green
- [ ] `npm run self-check` (or `node scripts/self-check.mjs --allow-warn`) acceptable

---

## 2. Doctor / binary smoke

```bash
node bin/xclaw.mjs --version   # or status shows 3.7.3
node bin/xclaw.mjs doctor
node bin/xclaw.mjs status
```

- [ ] Doctor completes without fatal errors
- [ ] Swarm section appears (agents / runs) when configured
- [ ] Gateway token / profile notes understood for lab vs prod

---

## 3. Feature proof matrix (S0–S3)

### S0 — Durable subagents

- [ ] Spawn subagent → snapshot under `~/.xclaw/swarms/agents/`
- [ ] Timeout path persists status
- [ ] Gateway restart: `reconcileStaleAgents` does not leave forever-running ghosts

### S1 — Fan-out

**Tool registration**

- [ ] Parent agent tool list includes `xclaw_swarm_run` when `swarm.enabled !== false`
- [ ] Tool schema accepts `goal` + `tasks` (strings and/or `{task, role}`)
- [ ] Disabled swarm (`swarm.enabled: false`) returns clear error / no tool spam

**Flat string tasks**

- [ ] `tasks: ["A", "B", "C"]` → auto ids `t0..t2`, all wave 0
- [ ] Children run with concurrency ≤ `maxParallel` (default 3)
- [ ] Join summary markdown returned in tool result
- [ ] Summary includes goal, swarm id, per-child status + truncated text

**Object tasks + roles**

- [ ] `{ "task": "…", "role": "research" }` runs research isolation defaults
- [ ] `role: "implement"` requests worktree isolation when git repo available
- [ ] `role: "verify"` / `"critic"` use shared cwd defaults
- [ ] Unknown role falls back to research (or documented behavior)

**Caps & limits**

- [ ] `maxParallel` respected (hard max 5)
- [ ] `maxChildrenPerRun` respected (hard max 8)
- [ ] Over-cap task list → structured rejection (not silent truncate)
- [ ] `subagentTimeoutMs` applied to children (or inherited)

**Persistence**

- [ ] SwarmRun written under `~/.xclaw/swarms/runs/<id>.json`
- [ ] Run record has `status`, `children`, `summary` / results
- [ ] Child agent snapshots appear under `~/.xclaw/swarms/agents/` when S0 enabled

**Events / observability**

- [ ] `onEvent` (or logs) emit `child_start` / `child_done` with swarm id
- [ ] Partial failure: some children ok, some error → run `status: partial` (or equivalent)
- [ ] All children fail → run not reported as full success

**Unit / automated**

- [ ] `test/s1-swarm-run.test.mjs` PASS (fan-out tool + caps)
- [ ] Manual or mock: three research tasks complete without hanging the parent loop

**Regression vs S2**

- [ ] Flat tasks still work after S2 graph changes (no required `dependsOn`)
- [ ] S1-only run does not require merge proposal if no implement worktree changes

### S2 — Task graph

- [ ] DAG with `id` + `dependsOn` → topological waves
- [ ] Upstream text appears in downstream prompt
- [ ] Cycle / unknown dep → structured error codes (`CYCLE`, `UNKNOWN_DEP`)
- [ ] `onDepFail: skip-downstream` skips children after failure
- [ ] Join summary includes ASCII waves

### S2 extras — Retry / backoff

- [ ] Transient `SPAWN_FAILED` can retry (`nodeRetries`)
- [ ] `retryStrategy` accepts `decorrelated` | `exponential` | `full` | `equal` | `none`

### S3 — Safe merge

- [ ] Implement worktree → `git apply --check` before write
- [ ] Default **no** auto-merge → `pending_approval` + proposal id
- [ ] `xclaw_swarm_merge_status` lists proposal
- [ ] `xclaw_swarm_merge_approve` re-checks then applies
- [ ] `xclaw_swarm_merge_reject` marks rejected
- [ ] Conflict path: dirty main → `merge.status: conflict`, no silent clobber
- [ ] Verify gate: failed verify → `merge_blocked` when `mergeRequireVerify: true`

---

## 4. Security / prod defaults

- [ ] `profile: prod` → approvals strict (no casual autoApprove if that is prod policy)
- [ ] `swarm.autoMerge: false`
- [ ] Merge tools require same session/owner trust as other write paths
- [ ] No Telegram/Slack tokens committed; env-only

---

## 5. Package artifact

```bash
npm run package
# or: node scripts/package-release.mjs
```

- [ ] Zip (or tarball) produced under `artifacts/` or `dist/`
- [ ] Zip contains `package.json` 3.7.3, `bin/`, `src/`, `docs/SHIP_3.7.3.md`
- [ ] Install scripts present: `install/install.sh`, `install/install.ps1`
- [ ] Record checksum:

```bash
shasum -a 256 xclaw-3.7.3*.zip
```

- [ ] Checksum noted in release notes / this file

**Artifact path:** ______________________  
**SHA-256:** ______________________

---

## 6. Install smoke (clean machine or temp HOME)

```bash
# example
export HOME=/tmp/xclaw-ship-home
mkdir -p "$HOME"
# unpack zip, npm link or node bin/xclaw.mjs doctor
```

- [ ] Fresh config creates under `$HOME/.xclaw/`
- [ ] Doctor runs
- [ ] Gateway starts (or computer sidecar) with documented ports

---

## 7. Optional live soak (API key)

Only with a real key; skip offline ship:

- [ ] Small DAG: research → research → merge text task
- [ ] implement → verify (no merge auto) → approve merge on a **scratch git repo**
- [ ] Cost / token usage noted

---

## 8. Release notes (copy-paste)

```markdown
## XClaw 3.7.3

### Highlights
- **S3 Safe merge:** worktree patches gated by `git apply --check`; prod stays pending approval
- **S2 Task graphs:** `dependsOn`, wave scheduler, upstream handoff, structured errors
- **Retries:** decorrelated / exponential / full / equal backoff on transient node failures
- **S1/S0:** parallel swarm fan-out + durable agent/run registry

### Tools
- `xclaw_swarm_run` (+ `autoMerge` optional)
- `xclaw_swarm_merge_approve` | `reject` | `status`

### Defaults
- `swarm.autoMerge: false`
- `swarm.mergeRequireVerify: true`

### Docs
- docs/S3_SAFE_MERGE.md, docs/S2_TASK_GRAPH.md, docs/SHIP_3.7.3.md
```

---

## 9. Sign-off

| Role | Name | Date |
|------|------|------|
| Builder | | |
| Reviewer | | |

**Ship decision:** [ ] GO  [ ] HOLD (reason: ________)

---

## Quick command block

```bash
node --test test/graph-viz.test.mjs test/s2-swarm-graph.test.mjs test/s3-swarm-merge.test.mjs
node bin/xclaw.mjs doctor
npm run package
shasum -a 256 dist/xclaw-*.zip 2>/dev/null || shasum -a 256 artifacts/xclaw-*.zip
```
