# S3 — Safe worktree merge

## Flow

```text
implement (worktree) → verify/critic gates
  → git apply --check (serial per candidate)
  → autoMerge? apply : save proposal (pending_approval)
  → owner: xclaw_swarm_merge_approve | reject
```

## Policy (`swarm`)

| Key | Default | Meaning |
|-----|---------|---------|
| `mergeEnabled` | true | Run merge phase after swarm |
| `autoMerge` | false | Apply without approval |
| `autoMergeLab` | false | Lab convenience (only if profile lab/dev and autoMerge unset) |
| `mergeRequireVerify` | true | If verify nodes exist, all must ok |
| `mergeRequireCriticPass` | false | Block on critic “do not merge” language |
| `cleanupWorktreeAfterMerge` | false | Remove worktree after successful apply |

## Tools

| Tool | Purpose |
|------|---------|
| `xclaw_swarm_run` + `autoMerge` | Optional auto apply after gates |
| `xclaw_swarm_merge_status` | List / get proposals |
| `xclaw_swarm_merge_approve` | Re-check + apply |
| `xclaw_swarm_merge_reject` | Discard proposal |

## Proposal store

`~/.xclaw/swarms/merge-proposals/<id>.json`

## Status values

| Status | Meaning |
|--------|---------|
| `noop` | No worktree changes |
| `blocked` | Gates failed |
| `conflict` | `git apply --check` failed |
| `pending_approval` | Clean check; waiting for owner |
| `merged` / `applied` | Patches on main |
| `partial` | Some applied, some failed |
| `rejected` | Owner rejected |

## Safety

1. Never apply without successful `--check`
2. Re-check on approve (main may have moved)
3. Prod keeps `autoMerge: false`
4. Main ends with uncommitted working tree changes (owner commits)
