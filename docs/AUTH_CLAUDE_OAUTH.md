# Claude / Anthropic OAuth (PKCE)

XClaw can use the same **browser → paste code** flow as Claude Code.

## Official preferred auth

For pure API billing, use an API key:

```bash
xclaw models auth login --provider anthropic --method api-key --api-key sk-ant-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

OAuth is for **Claude subscription** style access (Pro/Max/Team), same family as Claude Code login. Anthropic may change endpoints or terms; treat as **experimental**.

## Login

```bash
xclaw models auth login --provider anthropic --method oauth
# aliases
xclaw models auth login --provider claude --method oauth --name my-claude
```

1. Terminal prints an authorize URL (PKCE `code_challenge` + `state`).
2. Open it while logged into [claude.ai](https://claude.ai).
3. Approve → copy the code (`CODE` or `CODE#STATE`).
4. Paste into the terminal.
5. Tokens are stored under `~/.xclaw/agents/main/auth-profiles.json` (mode `oauth`).

Non-interactive:

```bash
xclaw models auth login --provider anthropic --method oauth --code 'PASTED_CODE'
```

## Env overrides

| Variable | Purpose |
|----------|---------|
| `XCLAW_ANTHROPIC_OAUTH_CLIENT_ID` | Override client id (default = Claude Code public id) |
| `XCLAW_ANTHROPIC_OAUTH_AUTHORIZE_URL` | Authorize URL |
| `XCLAW_ANTHROPIC_OAUTH_TOKEN_URL` | Token URL (default `https://api.anthropic.com/v1/oauth/token`) |
| `XCLAW_ANTHROPIC_OAUTH_REDIRECT_URI` | Must match authorize request |
| `XCLAW_ANTHROPIC_OAUTH_SCOPE` | Space string |
| `XCLAW_ANTHROPIC_OAUTH_MODE` | `max` (claude.ai) or `console` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Long-lived token from `claude setup-token` |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token for gateways |

## How it maps to your Claude Code link

Your URL shape:

```text
https://claude.ai/oauth/authorize
  ?code=true
  &client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e
  &response_type=code
  &redirect_uri=https://platform.claude.com/oauth/code/callback
  &scope=...
  &code_challenge=...
  &code_challenge_method=S256
  &state=...
```

XClaw generates the same parameter set with a **fresh** PKCE pair each login (do not reuse an old `code_challenge` from another app session).

## API usage

Resolved token is used as the provider credential for `anthropic` / `claude-*` models (Bearer). Refresh uses `grant_type=refresh_token` when a refresh token was stored.

## Notes

- Token exchange body is **JSON**, not form-urlencoded.
- Paste codes expire quickly; exchange immediately.
- Do not commit tokens. Profile files are mode `0600`.


## Extracted from Claude Code binary (2.1.226)

Native package `@anthropic-ai/claude-code-linux-x64` embeds:

| Constant | Value |
|----------|--------|
| Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Authorize | `https://claude.ai/oauth/authorize` · `https://platform.claude.com/oauth/authorize` |
| Callback | `https://platform.claude.com/oauth/code/callback` |
| Token | **`https://platform.claude.com/v1/oauth/token`** |
| Credential key | `claudeAiOauth` in `~/.claude/.credentials.json` |

XClaw defaults match these.

## Import existing Claude Code login

If you already ran `claude` and logged in:

```bash
xclaw models auth login --provider anthropic --method import-claude-code
```

Reads `~/.claude/.credentials.json` → stores tokens in XClaw profiles.


## OAuth system attestation (required)

Anthropic gates **subscription OAuth** inference on an exact system prefix
(same as [sudo-ai](https://github.com/Matrixx0070/sudo-ai) `OAUTH_ATTESTATION`):

```text
You are Claude Code, Anthropic's official CLI for Claude.
```

Without this as the **first** system text, Sonnet / Opus / Fable often return
**HTTP 429** `rate_limit_error` (misleading). Haiku may still work.

XClaw helpers:

```js
import {
  OAUTH_ATTESTATION,
  ensureOAuthSystemAttestation,
  buildAnthropicOAuthHeaders,
} from "../src/providers/anthropic-oauth-headers.mjs";

const body = { model, max_tokens, messages, system: userSystem };
ensureOAuthSystemAttestation(body);
// body.system now starts with OAUTH_ATTESTATION
```

Headers for OAuth:

```http
Authorization: Bearer sk-ant-oat01-…
anthropic-version: 2023-06-01
anthropic-beta: oauth-2025-04-20
x-app: cli
user-agent: claude-code/2.1.226
```


## Full XClaw integration (v3.67+)

### Login
```bash
xclaw models auth login --provider anthropic --method oauth
# or import Claude Code credentials
xclaw models auth login --provider anthropic --method import-claude-code
```

### Select model
```bash
# config
{ "agent": { "provider": "anthropic", "model": "claude-sonnet-5" } }

# or env
export XCLAW_PROVIDER=anthropic
export XCLAW_MODEL=claude-sonnet-5
```

### Models (OAuth-capable)
- claude-sonnet-5 / claude-sonnet-4-6 / claude-sonnet-4-5-20250929
- claude-opus-5 / claude-opus-4-8 / …
- claude-fable-5
- claude-haiku-4-5-20251001

### Implementation
- `src/providers/anthropic-messages.mjs` — native `/v1/messages`
- Auto OAuth attestation + headers for `sk-ant-oat*` tokens
- Agent loop uses `resolveProviderRouteAsync` so auth profiles load
