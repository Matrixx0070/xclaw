# S4 — Merge governance

Builds on S3 safe merge with stricter **main-repo** policy.

## Features

| Flag | Default | Behavior |
|------|---------|----------|
| `swarm.mergeRequireCleanMain` | `false` | Block plan/approve if main has unstaged **or** staged changes |
| `swarm.mergeUseIndex` | `false` | Use `git apply --check --index` / `git apply --index` |

## Clean main

```bash
git diff --quiet && git diff --cached --quiet
```

If either fails → `merge.status: blocked`, code **`MAIN_DIRTY`**.

Owner should `git stash` / commit before approve.

## `--index` mode

- Check requires index ≈ worktree on touched paths  
- Successful apply **stages** files (ready to commit)  
- Stricter; more likely to fail on dirty main  

## Doctor

```text
swarm.merge — prints autoMerge / requireVerify / requireCleanMain / useIndex
swarm.merge.proposals — pending proposal count
swarm.autoMerge.prod — warn if autoMerge under prod
```

## Recommended prod

```json
{
  "swarm": {
    "autoMerge": false,
    "mergeRequireVerify": true,
    "mergeRequireCleanMain": true,
    "mergeUseIndex": false
  }
}
```

Turn on `mergeUseIndex: true` only if you want staged results and a clean index/worktree discipline.
