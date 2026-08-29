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
| POST | `/queue` | Enqueue `{ goal, verify?, workspace?, maxTurns?, timeoutMs?, priority?, class?, harness?, groundHard?, claimsRequireEvidence?, requireStructuredClaims? }` |
| POST | `/queue/pause` `/queue/resume` | Worker control |
| POST | `/queue/clear` | Remove terminal items |
| POST | `/queue/retry-failed` | Requeue failures |
| POST | `/queue/:id/cancel` | Cancel one |

`POST /queue` accepts only the fields listed above. `maxAttempts`, `maxWaitMs`
and `priorityClass` are refused on purpose — the first two are ceilings the
config owns (anyone with the gateway token could otherwise ask for 99 retries
or a job that is never abandoned), the third is an internal alias of `class`.
Send one anyway and the 202 names it back:

```json
{ "id": "q_...", "status": "queued",
  "withheld": [{ "field": "maxAttempts",
                 "reason": "retry budget is config-owned (queue.maxAttempts)" }] }
```

`xclaw queue batch` posts through the same route, so the same list applies.

## Item fields

| Field | Default | Notes |
|-------|---------|--------|
| priority | 0 | Higher first |
| maxAttempts | 1 (2 for harness) | Auto-requeue on fail. Config-owned — not settable per request |
| timeoutMs | 180000 | Job wall timeout |
| maxTurns | agent default | Agent loop cap |
| maxWaitMs | queue.maxWaitMs (300000) | Abandon if never started. Config-owned — see ADMISSION_CONTROL.md |

## Config

```json
"queue": { "concurrency": 1 }
```

Concurrency clamped to **1–3**.
