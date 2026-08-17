# XClaw Autonomy

Single knob for how much the agent may act without a human in the loop.

## Levels

| Level | autoApprove | Heartbeat | Default maxTurns | Intended use |
|-------|-------------|-----------|------------------|--------------|
| `off` | false (always ask) | off | 8 | Demos / high-risk hosts |
| `supervised` | safe tools only | off | 12 | Production default |
| `lab` | all tools | off | 20 | Local eval / development |
| `full` | all tools | **on** | 24 | Long-lived owner agent |

Set via config or env:

```json
{ "autonomy": { "level": "full" } }
```

```bash
XCLAW_AUTONOMY_LEVEL=supervised XCLAW_PROFILE=prod node bin/xclaw.mjs gateway
```

If `autonomy.level` is omitted, **profile** is used: `prod`/`dev` → `supervised`, else `lab`.

Explicit `security.*` and `agent.maxTurns` always win over level defaults.

## Heartbeat (R4)

When `autonomy.heartbeat.enabled` is true (default on for `full`):

- Runs on a schedule (`everyMs`, **minimum 60s**)
- Prompt defaults to asking for `HEARTBEAT_OK` when nothing needs action
- Honors `quietHours` and `maxUsdPerDay`
- Optional delivery to Telegram/Discord/Slack via `autonomy.heartbeat.delivery`

Force a run:

```bash
curl -X POST http://127.0.0.1:18790/cron/jobs/<heartbeat-id>/run
```

List jobs: `GET /cron/jobs`

## Related surfaces

- **Jobs** — `POST /jobs` with `verify[]` for objective long-horizon goals
- **Checkpoints** — `GET /checkpoints`, `POST /checkpoints/resume`
- **Queue** — `POST /queue` (pass `workspace` for correct verify roots)
- **Swarm** — `POST /swarm/run/stream` DAG with implement → verify

Doctor reports `autonomy.level` and `autonomy.heartbeat`.
