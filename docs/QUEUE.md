# XClaw job queue

Serial (or low-concurrency) disk-backed job queue under `~/.xclaw/job-queue/`.

## Commands

```bash
xclaw queue add "goal text"
xclaw queue list
xclaw queue stats
xclaw queue dead              # failed after maxAttempts
xclaw queue get <id>
xclaw queue batch file.json
xclaw queue cancel <id>
xclaw queue clear
xclaw queue retry
xclaw queue pause | resume
```

## HTTP

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/queue` | List + worker + stats |
| GET | `/queue/stats` | Counts by status |
| GET | `/queue/dead` | Exhausted failures |
| POST | `/queue` | Enqueue `{ goal, verify?, maxTurns?, timeoutMs?, maxAttempts?, priority? }` |
| POST | `/queue/pause` `/queue/resume` | Worker control |
| POST | `/queue/clear` | Remove terminal items |
| POST | `/queue/retry-failed` | Requeue failures |
| POST | `/queue/:id/cancel` | Cancel one |

## Item fields

| Field | Default | Notes |
|-------|---------|--------|
| priority | 0 | Higher first |
| maxAttempts | 1 | Auto-requeue on fail |
| timeoutMs | 180000 | Job wall timeout |
| maxTurns | agent default | Agent loop cap |

## Config

```json
"queue": { "concurrency": 1 }
```

Concurrency clamped to **1–3**.
