# XClaw 1.0 release notes

## Stability (Phase A)
- Supervised computer (PID, logs, restart, watchdog with backoff)
- Eval CI gate + baseline regress + trend.jsonl

## Autonomy (Phase B)
- Hard eval pack (debug / pipeline / config / todos / grounding) — **5/5 live**
- Grounding hard mode; per-tool truncation budgets

## Scale (Phase C)
- Approval policy + Control UI
- Durable workspace memory
- Subagent isolation

## Ship (Phase D)
- Docker Compose + systemd + logrotate
- Gateway token + optional `/metrics` protection
- README golden path + frozen `/routes`

## Upgrade
1. Export `XAI_API_KEY` (and optional `XCLAW_GATEWAY_TOKEN`)
2. `npm run dev-up` or `docker compose -f deploy/docker-compose.yml up -d`
3. `xclaw wait-ready && npm run eval:ci`
