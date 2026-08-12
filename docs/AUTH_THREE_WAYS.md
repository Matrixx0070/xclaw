# XClaw uses Grok models in **3 ways**

Whoever installs XClaw can choose:

| # | Mode | Command | Account |
|---|------|---------|---------|
| **1** | **Grok API** | `export XAI_API_KEY=...` or `xclaw auth login --method api` | Console key ([console.x.ai](https://console.x.ai)) |
| **2** | **Grok OAuth / CLI** | `xclaw auth login --method oauth` (or `device` / `pkce` / `import-grok`) | CLI / OAuth tokens |
| **3** | **Grok Web login** | `xclaw auth login --method web` then `xclaw auth web-import ...` | Sign in at **grok.com** (free or subscription), import session |

```bash
xclaw auth modes
xclaw auth status
```

---

## 1 — Grok API

```bash
export XAI_API_KEY=xai-...
xclaw auth login --method api
xclaw auth status
```

---

## 2 — Grok OAuth CLI login

```bash
# Option A: official Grok CLI session
grok login
xclaw auth login --method import-grok

# Option B: device / PKCE
xclaw auth login --method oauth
xclaw auth login --method device
xclaw auth login --method pkce
```

---

## 3 — Grok Web login (free or subscription)

```bash
xclaw auth login --method web
# → open grok.com / accounts.x.ai, sign in (free or paid)

# then import session from your browser:
xclaw auth web-import --cookie "name=value; ..."
# or
xclaw auth web-import --file ./session.json
# session.json example:
# { "cookie": "...", "authorization": "Bearer ..." }
```

Stored at `~/.xclaw/web-session.json` (mode 0600).

Works with **the same web account** you use on grok.com — free tier or subscription.  
Session format is defined by xAI and may need updates if they change cookies.

---

## Priority (auto)

```text
api key → oauth tokens → web session → (else local Ollama)
```

Force one mode:

```json
{ "auth": { "mode": "web" } }
```

or `XCLAW_AUTH_MODE=api|oauth|web`

---

## Code

- `src/auth/modes.mjs` — catalog of 3 modes  
- `src/auth/xai-oauth.mjs` — API + OAuth load  
- `src/auth/web-login.mjs` — web session import  
- `src/cli/auth-cli.mjs` — CLI  
