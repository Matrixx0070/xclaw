# Sign in with Grok / xAI (Option B)

Local XClaw can use **your Grok / xAI account** for model access.

```bash
xclaw auth login
xclaw auth status
xclaw auth logout
```

## What this is

| | |
|--|--|
| **Yes** | Log in so XClaw calls Grok models as **you** |
| **No** | Not “log into the Grok chat seat / sandbox” |

Brain = your account in the cloud. Hands = **your** PC.

## Methods

### 1. Auto (default)

```bash
xclaw auth login
```

Order:

1. Import `~/.grok/auth.json` if you already ran **`grok login`**
2. Else device-code flow (URL + code in terminal)
3. Else guidance for API key / PKCE

### 2. Reuse official Grok CLI session

```bash
grok login          # official CLI, browser OAuth
xclaw auth login --method import-grok
# or: xclaw auth import-grok
```

### 3. Device code

```bash
xclaw auth login --method device
```

Prints a URL + code → you approve in the browser → XClaw stores tokens in `~/.xclaw/auth.json` (mode 0600).

### 4. Browser PKCE (desktop)

```bash
xclaw auth login --method pkce
```

Opens loopback callback on `127.0.0.1`. Needs a registered OAuth **client id** when xAI issues one for XClaw.

### 5. API key fallback (always works)

```bash
# https://console.x.ai → API Keys
export XAI_API_KEY=xai-...
xclaw auth status
```

Note: **API billing** and **SuperGrok / app subscription** can be separate systems.

## Config

```json
{
  "auth": {
    "xai": {
      "clientId": "xclaw-cli",
      "authHost": "https://auth.x.ai",
      "accountsHost": "https://accounts.x.ai"
    }
  }
}
```

## Files

| Path | Purpose |
|------|---------|
| `~/.xclaw/auth.json` | XClaw OAuth tokens |
| `~/.grok/auth.json` | Official Grok CLI (optional import) |

## Code

- `src/auth/xai-oauth.mjs`
- `src/cli/auth-cli.mjs`
