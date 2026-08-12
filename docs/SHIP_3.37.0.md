# Ship 3.37.0 — Stream resume

## What’s new

- Last-Event-ID resume for **agent / swarm / webchat** streams
- NDJSON + SSE dual writer + heartbeat
- `xclaw run` CLI with `--resume`, exit codes, backoff
- Prometheus stream metrics + Grafana dashboard + recording rules
- `stream.*` config knobs + validation details

## Upgrade

1. Update to 3.37.0
2. Optional: add `stream` block to `~/.xclaw/xclaw.json` (defaults apply if omitted)
3. Restart gateway: `xclaw gateway`
4. Point Prometheus at `/metrics`; import `deploy/grafana/xclaw-stream-dashboard.json`

## Smoke

```bash
xclaw gateway &
xclaw run --ndjson "echo hi from stream"
# note streamId / lastEventId from stderr, then:
# xclaw run --resume <streamId> --last-event-id <id>
curl -fsS http://127.0.0.1:18790/metrics | grep xclaw_stream
xclaw doctor
```

## Docs

| Doc | Topic |
|-----|--------|
| [stream-config.md](./stream-config.md) | `stream.*` knobs |
| [cli-run-exit-codes.md](./cli-run-exit-codes.md) | Exit codes + scripting |
| [backoff-strategies.md](./backoff-strategies.md) | full / equal / decorrelated |
| [error-handling-stream.md](./error-handling-stream.md) | Config + ResumeError details |
| [../OPS.md](../OPS.md) | Ops scrape / checklist |

## Compatibility

- Existing non-stream `xclaw agent` unchanged
- Stream endpoints accept clients that ignore `streamId` (still work as fire-and-forget SSE)
- Metric label cardinality bounded (no `streamId` on Prometheus series)
