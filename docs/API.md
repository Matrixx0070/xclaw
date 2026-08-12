# XClaw gateway API (1.0 freeze)

Discover live list:

```bash
xclaw routes
curl -s http://127.0.0.1:18790/routes | jq
```

## Ops (stable)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness (computer + queue) |
| GET | `/metrics` | Prometheus (optional auth if `protectMetrics`) |
| GET | `/version` | Version + uptime |
| GET | `/routes` | This map |
| GET | `/dashboard` | Ops snapshot |
| GET | `/report` | Markdown status |
| POST | `/config/reload` | Soft config reload |

## Agent / jobs / queue / eval / security
See QUEUE.md, EVAL_AND_JOBS.md, PHASE_C.md.

## Auth
Set `XCLAW_GATEWAY_TOKEN` or `gateway.token`. Sensitive routes require `Authorization: Bearer <token>`.
With `gateway.protectMetrics: true`, `/metrics` also requires the token.
