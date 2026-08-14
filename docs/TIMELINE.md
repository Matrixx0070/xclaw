# Time-Travel & State Recovery

Git-only by design — git already is the snapshot system. What A3 adds is the
missing commit and the refs around it.

## Commit-on-merge

`applyWorktreeMerge(..., { commit })` commits the applied changes with an
`XClaw-Mission: <id>` trailer — **only when the repo was clean before the
merge** (a dirty repo keeps the old behavior with an honest `commit: null`;
never a commit that swallows operator work). Missions enable it by default
(`missions.commitOnMerge: false` to opt out). This is what makes merges
revertable, attributable and anchorable — pre-A3 merges left the repo dirty,
which also caused untracked-collision and patch-conflict failures on
subsequent missions touching the same files.

## Refs

- `refs/xclaw/missions/<id>` — each mission's merge commit
- `refs/xclaw/known-good/<ts>` — blessed states (auto-marked on mission merge
  unless `missions.markKnownGoodOnMerge: false`; keeps the newest 10). These
  refs also anchor the commits against gc.

Per-phase WIP snapshots are committed on the mission branch inside the
worktree (ecosystem/verify artifacts excluded so merge-exclusion still works);
failed missions keep their worktree, so the phase commits are the forensic
timeline.

## CLI

```
xclaw timeline list [--repo dir]
xclaw timeline diff <refA> <refB> [--patch]
xclaw timeline revert <missionId>     # git revert of the merge commit;
                                      # conflicts abort cleanly (no half-revert);
                                      # prints non-git effects from the ledger
xclaw timeline known-good [sha] [--note …]
xclaw timeline attribute <path>       # commits + missionIds that touched it
```

## Honest scope

Committed state (source, lockfiles → `npm ci`) is recoverable. Operational
state under `~/.xclaw`, installed globals, services, and network/browser side
effects are attributed (ledger `effects`) and reported by `revert` — not
undone.
