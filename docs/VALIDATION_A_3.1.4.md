# Option A validation — XClaw 3.1.4 (sandbox)

**Date:** 2026-08-06  
**Host:** ephemeral sandbox (not a persistent production machine)

## Results

| Step | Result | Notes |
|------|--------|-------|
| Unit battery (29 tests) | **PASS** | OAuth, refresh, retry, gateway auth, channels, P3 |
| `eval:regression` | **PASS** | (from prior ship run) |
| Gateway start | **PASS** | Listens **:18790**; computer **:4243** |
| `GET /ready` | **PASS** | `ready: true`, computer ok |
| `GET /health` | **PASS** | XClaw-Gateway healthy, computer up |
| Agent without token | **PASS** | HTTP **401** unauthorized |
| Agent wrong token | **PASS** | HTTP **401** |
| Agent with gateway token | **PASS*** | Auth OK; **500** no model API key (expected) |
| Computer `/health` | **PASS** | healthy |
| `auth connected list` | **PASS** | github, google |
| `auth connected login github` | **PASS*** | Clear error: set `XCLAW_GITHUB_OAUTH_CLIENT_ID` |
| Doctor | **PASS** with warns | API key missing; watchdog/cron noise |

\*Expected failure modes without live secrets.

## Bug found & fixed during A

| Issue | Fix |
|-------|-----|
| `xclaw auth connected login` → `get is not defined` | Local `get(flag)` helper in `bin/xclaw.mjs` auth case |

## Blocked on this sandbox (need your machine / secrets)

| Check | Needs |
|-------|--------|
| Live agent reply | `XAI_API_KEY` / `XCLAW_API_KEY` |
| Telegram round-trip | `TELEGRAM_BOT_TOKEN` + enabled channel |
| Slack / Email | tokens + config |
| Full GitHub OAuth browser | `XCLAW_GITHUB_OAUTH_CLIENT_ID` (+ secret) + real browser |
| Token refresh against provider | OAuth tokens from successful login |

## Ports reminder

```text
Gateway  http://127.0.0.1:18790
Computer http://127.0.0.1:4243
WebChat  http://127.0.0.1:18790/chat/
```

## Your machine (complete A)

```bash
export XAI_API_KEY=...
export XCLAW_GATEWAY_TOKEN=...
node bin/xclaw.mjs gateway
curl -fsS http://127.0.0.1:18790/ready
curl -fsS -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"say pong"}' \
  http://127.0.0.1:18790/agent/run
```

## Verdict

**Core stack validates in sandbox.** Production A is incomplete until API key + (optional) channel/OAuth secrets are supplied on a persistent host.
