# Free Grok account + XClaw

You asked: **make it work on a free Grok account too.**

## Honest split (xAI policy)

| Product | Free Grok chat account | What XClaw can use |
|---------|------------------------|--------------------|
| **grok.com / app chat** | Yes (rate limits) | Not a programmable API for third-party apps |
| **Official Grok API** (`api.x.ai`) | Needs **API key** from [console.x.ai](https://console.x.ai); usage is metered. New accounts sometimes get **promo credits** — check Billing. | `XAI_API_KEY` |
| **OAuth (Grok CLI / some tools)** | Often tied to **Grok app / Build CLI / listed partners**, not open third-party OAuth | `grok login` → `xclaw auth import-grok` **if** CLI accepts your account |
| **Local models** | No xAI account needed | **Always works offline** (Ollama, etc.) |

Official line (approx.): **API = API key**; **OAuth ≠ general third-party API** for arbitrary apps.

So XClaw cannot promise “free grok.com login → unlimited cloud Grok in XClaw.”  
It **can** promise: **free users fully run XClaw** with a clear ladder.

---

## Ladder (free → cloud)

### 1) Fully free (recommended default for free accounts)

```text
Brain:  Ollama (local) — qwen2.5:7b or smaller
Hands:  your PC (XClaw tools)
Mouth:  Piper / espeak / seat Voice if on Grok computer
Auth:   none required
```

```bash
ollama pull qwen2.5:7b
# xclaw.json
{
  "agent": { "provider": "ollama", "model": "qwen2.5:7b" },
  "voice": { "provider": "local" }
}
```

**No Grok subscription. No API card.**

### 2) Free/promo cloud Grok API

1. Sign in at [console.x.ai](https://console.x.ai) (same ecosystem login is fine).  
2. Check **credits / free tier** on Billing.  
3. Create API key.  
4. 

```bash
export XAI_API_KEY=xai-...
xclaw auth status
```

Works on a **free chat** account **if** console gives key + credits; otherwise pay-as-you-go.

### 3) OAuth via Grok CLI (when your account is allowed)

```bash
grok login
xclaw auth import-grok
```

If CLI rejects free tier, fall back to (1) or (2).

---

## XClaw policy

```text
auth mode auto:
  1. ~/.xclaw/auth.json tokens
  2. ~/.grok/auth.json (import)
  3. XAI_API_KEY
  4. else → local Ollama (free path) — do not hard-fail
```

Cloud Grok is **optional**. Free account users are first-class via **local**.

---

## What we will not claim

- Free grok.com chat password → drive `api.x.ai` without key/credits  
- Universal OAuth for every free account (xAI does not offer that to all third parties)

## What we do claim

- XClaw **installs and runs** on free accounts  
- **Full system control** does not need paid Grok  
- **Voice** via bundled/local TTS  
- **Optional** upgrade to Grok API when you have a key or promo credits  
