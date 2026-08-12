# S1 — Swarm fan-out

## Tool

`xclaw_swarm_run` (parent agent)

```json
{
  "goal": "Compare three approaches",
  "tasks": [
    { "task": "Summarize approach A", "role": "research" },
    { "task": "Summarize approach B", "role": "research" },
    { "task": "Summarize approach C", "role": "research" }
  ]
}
```

## Roles

| Role | Default | Isolation |
|------|---------|-----------|
| research | maxTurns 6 | temp isolate |
| implement | maxTurns 8 | **worktree** |
| verify | maxTurns 5 | shared cwd |
| critic | maxTurns 4 | shared cwd |

## Caps (`swarm` config)

- `maxParallel` (default 3, hard max 5)
- `maxChildrenPerRun` (default 8)
- `subagentTimeoutMs` (default 300000)

## Join

After all children finish, a markdown **join summary** is returned and stored on the `SwarmRun` record under `~/.xclaw/swarms/runs/`.
