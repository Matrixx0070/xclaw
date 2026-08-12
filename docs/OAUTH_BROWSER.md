# OAuth browser login (PKCE)

XClaw supports **authorization code + PKCE** loopback login for connected apps.

## Connected apps (GitHub, Google)

### 1. Register an OAuth App

**GitHub:** Settings → Developer settings → OAuth Apps  

- Homepage: `http://127.0.0.1`  
- **Authorization callback URL:** `http://127.0.0.1:8765/auth/callback`  
  (port must match `XCLAW_OAUTH_CALLBACK_PORT`, default **8765**)

### 2. Set client credentials

```bash
export XCLAW_GITHUB_OAUTH_CLIENT_ID=Iv1.xxxx
# Optional but recommended for GitHub OAuth Apps:
export XCLAW_GITHUB_OAUTH_CLIENT_SECRET=xxxx
```

Google:

```bash
export XCLAW_GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
export XCLAW_GOOGLE_OAUTH_CLIENT_SECRET=....
```

### 3. Login

```bash
xclaw auth connected login github
# or
xclaw auth login --connected github
xclaw auth connected status
```

Browser opens → approve → callback on loopback → tokens stored in  
`~/.xclaw/connected-tokens.json`.

### 4. Use

```bash
# Agent tools:
# call_connected_tool { tool_name: "github_request", arguments: { path: "/user" } }
```

Refresh (if refresh_token present):

```bash
xclaw auth connected refresh github
```

## Model provider OAuth (existing)

```bash
xclaw models auth login --provider openai --method oauth   # Codex PKCE
xclaw auth login --oauth                                   # xAI experimental
```

Prefer **API keys** for always-on gateways.

## Implementation map

| Module | Role |
|--------|------|
| `src/auth/pkce.mjs` | S256 verifier/challenge |
| `src/auth/oauth-browser.mjs` | Loopback server + token exchange |
| `src/connected/oauth-providers.mjs` | GitHub / Google endpoints |
| `src/connected/oauth-login.mjs` | Login + refresh → token store |
| `src/connected/token-store.mjs` | `~/.xclaw/connected-tokens.json` |

## Security notes

- State parameter must match (CSRF).
- Prefer loopback `127.0.0.1`, not public redirect URLs.
- File store permissions: keep `~/.xclaw` private (`0700`).
- Client secret: use only on trusted machines; public native apps may omit when provider allows PKCE-only.
