# Eval harness & Job runtime (H0/H1)

## Jobs

A **job** has a goal, turn budget, optional **verify** checks, and an **evidence** log.

```bash
xclaw job "Create hello.txt with contents: hi"
```

```bash
curl -s -X POST http://127.0.0.1:18790/jobs \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Create README.md with first line # Eval Project","verify":[{"type":"file_exists","path":"README.md"}]}'
```

Status: `pending|running|succeeded|failed|cancelled|budget_exceeded`

## Eval

```bash
xclaw eval --mock                 # harness only (no API)
xclaw eval --tag smoke            # live model required
xclaw eval --tag autonomy --json --out report.json
xclaw eval --baseline eval/baselines/main.json --fail-on-regress
```

Cases live in `eval/cases/*.json`. Fixtures in `eval/fixtures/`.

## Verify check types

`file_exists`, `file_contains`, `file_equals`, `file_not_exists`, `command`, `text_contains`


## Job history

```bash
curl -s http://127.0.0.1:18790/jobs?limit=20 | jq
curl -s http://127.0.0.1:18790/jobs/<id> | jq
```

Stored under `~/.xclaw/jobs/`.

## Skill stats (H2)

```bash
curl -s http://127.0.0.1:18790/skills/stats | jq
```

File: `~/.xclaw/skill-stats.json` — runs, successes, successRate, version.

## Skill proposals

Failed live eval cases write drafts to `~/.xclaw/skill-proposals/` (`enabled: false`).

```bash
curl -s http://127.0.0.1:18790/skills/proposals | jq
```

Review and copy into `~/.xclaw/skills/<name>/SKILL.md` manually.

## Robustness

- `ensureComputer` auto-starts computer before agent sessions (3 attempts).
- Eval runner uses the same path.
- Computer client surfaces clear ECONNREFUSED recovery hints.
- Verify supports `caseInsensitive` and regex `flags`.

## Overnight eval cron

Enabled by default (`eval.cron.everyMs` = 24h). Registered when gateway starts.

```bash
xclaw eval-schedule status
xclaw eval-schedule register 3600000   # every hour (ms)
xclaw eval-schedule run                # run once now
curl -s http://127.0.0.1:18790/cron/eval | jq
```

Logs: `~/.xclaw/eval-cron.log`

## Job queue

Serial worker (concurrency 1). Persisted under `~/.xclaw/job-queue/`.

```bash
xclaw queue add "Create hello.txt with hi"
xclaw queue list
curl -s -X POST http://127.0.0.1:18790/queue -H 'Content-Type: application/json' \
  -d '{"goal":"Write status.txt with OK"}'
curl -s http://127.0.0.1:18790/queue | jq
```
