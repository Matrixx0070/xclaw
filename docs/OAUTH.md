# OAuth policy (Phase 4)

## Rule

**API keys are the default for always-on XClaw gateways.**  
Interactive OAuth is only offered where a real external flow exists.

| Provider | Recommended | OAuth? |
|----------|-------------|--------|
| **xai** | `api_key` from [console.x.ai](https://console.x.ai/team/default/api-keys) | Experimental OIDC only if `XCLAW_XAI_OAUTH_CLIENT_ID` is set |
| **openai** | `api_key` | Optional Codex PKCE if `XCLAW_OPENAI_OAUTH_CLIENT_ID` is set |
| **anthropic** | `api_key` | No browser OAuth — use `--method token` for setup-token paste |
| **openrouter** / **compatible** | `api_key` | None |

## Commands

```bash
xclaw models auth policy
xclaw models auth policy --provider xai

# Supported
xclaw models auth login --provider xai --method api-key --api-key xai-...
xclaw models auth login --provider anthropic --method token --token ...

# OAuth — fails clearly without client id
xclaw models auth login --provider xai --method oauth
xclaw models auth login --provider openai --method oauth
```

## What is NOT supported

- Pasting a bare `https://auth.x.ai/authorize` URL without a registered client
- SuperGrok / Grok Business seats as API credentials
- Claiming ChatGPT OAuth works without `XCLAW_OPENAI_OAUTH_CLIENT_ID`

## OpenAI Codex PKCE (optional)

```bash
export XCLAW_OPENAI_OAUTH_CLIENT_ID=...
xclaw models auth login --provider openai --method oauth
```

Callback: `http://127.0.0.1:1455/auth/callback` (override port with `XCLAW_OAUTH_CALLBACK_PORT`).
