---
name: tasks
description: Create, list, pause, resume, run, and inspect results of XClaw automations (scheduled prompts). Triggers on automation, schedule a task, remind me, recurring agent run, pause task, task results.
user-invocable: true
source: xclaw-bundled
priority: 70
---

# XClaw Automations / Tasks

Schedule an agent **prompt** to run later or on an interval. Results are stored under `~/.xclaw/automations.json`.

## CLI

```bash
xclaw automations list
xclaw automations add --every 3600000 --name hourly-status "Summarize open issues"
xclaw automations add --cron "0 9 * * *" --name morning "Daily briefing of project status"
xclaw automations pause <id>
xclaw automations resume <id>
xclaw automations run <id>
xclaw automations results [id] [limit]
xclaw automations delete <id>
```

## Schedule kinds

| Flag | Meaning |
|------|---------|
| `--every <ms>` | Interval (e.g. 3600000 = 1h) |
| `--cron "<expr>"` | 5-field cron (min hour dom month dow) |
| `--at <ISO>` | One-shot at time |

Gateway should call `hydrateAutomations(cfg)` on start so enabled jobs re-arm after restart.

## Agent behavior

When the user asks to schedule work, prefer `xclaw automations add` via bash (or explain the CLI). Do not invent a separate cloud task system.
