# Secrets & credentials

## Rules

1. **Never commit** API keys, OAuth tokens, GitHub PATs, or gateway tokens to git.
2. Prefer **environment variables** over config file values for secrets.
3. If a secret was pasted into chat, logs, or a ticket → **rotate it immediately**.
4. Prod: set `XCLAW_GATEWAY_TOKEN` (or `gateway.token`) and use profile `prod`.

## Recommended env vars

| Variable | Purpose |
|----------|---------|
| `XAI_API_KEY` | xAI / Grok |
| `OPENAI_API_KEY` | OpenAI-compatible |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude OAuth (if used) |
| `XCLAW_GATEWAY_TOKEN` | Gateway auth (prod) |
| `XCLAW_PROFILE` | `lab` \| `dev` \| `prod` |
| `XCLAW_OS_SANDBOX` | `auto` \| `bwrap` \| `off` — [OS_SANDBOX.md](./OS_SANDBOX.md) |
| `XCLAW_EGRESS` | `deny` \| `allow` \| `allowlist` |
| `XCLAW_BASH_ENV` | `strip-secrets` (default) \| `allowlist` \| `inherit` |
| `BRAVE_API_KEY` / `XCLAW_BRAVE_API_KEY` | Optional search; DuckDuckGo lite if unset. **Not** `BRAVE_SEARCH_API_KEY`. No Tavily. |
| `TELEGRAM_BOT_TOKEN` / `XCLAW_TELEGRAM_TOKEN` | Telegram bot |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | Slack bot + Socket Mode app token |
| `DISCORD_BOT_TOKEN` / `XCLAW_DISCORD_TOKEN` | Discord bot |
| `EMAIL_IMAP_*` / `EMAIL_SMTP_*` / `EMAIL_FROM` | Email channel |
| `XCLAW_SQLITE_VEC` | Optional host-built sqlite-vec path (not shipped) |

Template with empty placeholders: [`.env.example`](../.env.example) (copy to `.env`, which is gitignored). Docker compose uses [`deploy/env.example`](../deploy/env.example). Channel disconnect + SQLite backup: [CHANNEL_RECOVERY.md](./CHANNEL_RECOVERY.md).

## Config file

`~/.xclaw/xclaw.json` may hold non-secret settings. Avoid putting live keys there when env works.

```bash
export XAI_API_KEY=xai-...
export XCLAW_PROFILE=lab
node bin/xclaw.mjs doctor
```

## After a leak

1. Revoke/rotate the key at the provider console.
2. Remove from shell history if needed.
3. Grep the repo and `~/.xclaw` for residual copies.
4. Re-issue a new key into env only.

## CI

Use repository secrets / OIDC — never hardcode in workflow YAML or test fixtures.
