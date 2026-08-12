# Secure cookie handling (Grok Web login)

Web sessions are as sensitive as passwords.

## Protections in XClaw

| Control | Implementation |
|---------|----------------|
| **File permissions** | `~/.xclaw` dir `0700`, `web-session.json` `0600` |
| **Atomic write** | temp file + rename |
| **Encryption at rest** | AES-256-GCM envelope |
| **Secret key** | `XCLAW_SESSION_SECRET` (recommended) or machine-derived fallback |
| **Input validation** | max size, no CR/LF, cookie name checks |
| **Redaction** | status/logs never print full cookie |
| **TTL** | default 30 days (`auth.web.maxAgeMs`) |
| **Logout** | overwrite + unlink |

## Recommended

```bash
# Strong local key (store in password manager / env only)
export XCLAW_SESSION_SECRET="$(openssl rand -hex 32)"

xclaw auth login --method web
xclaw auth web-import --cookie "$COOKIE"
```

```json
{
  "auth": {
    "web": {
      "maxAgeMs": 604800000,
      "sessionSecret": null
    }
  }
}
```

Prefer **env** for the secret, not committing it in JSON.

## Do not

- Commit `web-session.json` or paste cookies into chat/issues  
- Share session files between machines without re-login  
- Log `Cookie` / `Authorization` headers  

## HttpOnly flags

| Flag | Meaning | XClaw |
|------|---------|--------|
| **HttpOnly** | Not readable via `document.cookie` | Parsed from Set-Cookie; stored in `cookies[]`; set on browser/CDP inject |
| **Secure** | HTTPS only | Forced for x.ai / grok.com |
| **SameSite** | Lax / Strict / None | Parsed; None forces Secure |

Request `Cookie:` headers are **name=value only**. HttpOnly applies when **storing** cookies in a browser.

```text
# Preserve HttpOnly on import
session=abc; Path=/; Domain=.x.ai; Secure; HttpOnly; SameSite=Lax
```

`webSessionBrowserCookies(session)` → CDP params with `httpOnly: true`.

## Secure cookie injection

```js
import {
  injectStoredWebSession,
  buildSecureInjectPlan,
  injectCookiesSecure,
} from "../src/auth/secure-inject.mjs";

await injectStoredWebSession(cdpSession, cfg, { url: "https://grok.com" });
```

| Guard | Behavior |
|-------|----------|
| HTTPS only | `http://` rejected |
| Host allowlist | grok.com, x.ai, accounts.x.ai, auth.x.ai |
| HttpOnly + Secure | Forced on inject |
| SameSite | Default Lax |
| Domain check | Outside allowlist → rejected |
| Audit | Cookie **names** only |
| clearFirst | Clears browser cookies before set |

## Code

- `src/auth/cookie-flags.mjs` — parse / flags  
- `src/auth/web-login.mjs` — encrypt, import/load  
- `src/auth/secure-inject.mjs` — allowlist + CDP/Playwright inject  
