# Phase F — Learn and parallelize

## Skills from failure
```bash
xclaw skills proposals
xclaw skills install <file.md>
xclaw skills reject <file.md> "not useful"
```

## Worktree subagent
Tool args: `{ "task": "...", "worktree": true }`  
Result includes `merge.stat` / `merge.diff` for parent.

## Context pressure
Agent emits `cache` / `pressure` events; high pressure tightens tool result caps.
