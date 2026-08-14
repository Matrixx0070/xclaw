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
