# Live model discovery

## Commands

```bash
# Static shipped catalog
xclaw models list
xclaw models list --provider xai

# Live merge (GET provider /models) + 1h disk cache
xclaw models list --live
xclaw models list --live --provider openai
xclaw models list --live --all          # include embeddings/tts/image
xclaw models list --live --force        # bypass cache

# Force refresh caches
xclaw models refresh
xclaw models refresh --provider xai

xclaw models cache-clear
```

## Cache

```
~/.xclaw/cache/models/<provider>.<keyfp>.json
```

TTL default **1 hour**. Stale cache is used if the network fails.

## Adapters

| Provider | Primary endpoint | Auth |
|----------|------------------|------|
| openai / groq / deepseek / mistral / openrouter / ollama / together | `GET {base}/models` | Bearer |
| xai | `GET {base}/language-models` → fallback `/models` | Bearer |
| anthropic | `GET /v1/models` | `x-api-key` + `anthropic-version` |
| google | `GET …/v1beta/models?key=` | API key query |

## Merge rules

1. Static row for known id → keep name/context; mark `live: true`
2. Live-only id → `source: "live"`
3. Default filter drops embedding / whisper / tts / image / video ids (`--all` keeps them)

## Config

```json
{
  "models": {
    "discovery": {
      "ttlMs": 3600000
    }
  }
}
```
