# S5 — Swarm & merge CLI

Operate swarm runs and merge proposals **without** the agent tool loop.

## Swarm

```bash
xclaw swarm status              # list recent runs
xclaw swarm status --json
xclaw swarm show <id>           # detail + ASCII graph when available
xclaw swarm show <id> --summary
xclaw swarm policy              # effective merge policy
```

Ids may be full UUID or unique prefix.

## Merge

```bash
xclaw merge list                # pending proposals
xclaw merge list --status all
xclaw merge show <proposalId>
xclaw merge approve <proposalId> [--cleanup] [--repo /path/to/repo]
xclaw merge reject <proposalId> optional reason
```

Approve re-runs `git apply --check` (and S4 clean-main / `--index` if configured).

## Paths

| Data | Location |
|------|----------|
| Runs | `~/.xclaw/swarms/runs/` |
| Proposals | `~/.xclaw/swarms/merge-proposals/` |

## Typical flow

```bash
xclaw swarm status
xclaw swarm show abc123 --summary
xclaw merge list
xclaw merge approve def456
```
