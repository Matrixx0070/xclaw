# Phase R — Product edges

## Cost UI
Open Control → Cost governor (spent vs soft/hard, pause).

## WebChat checkpoints
Sidebar → Refresh / Resume.

## Providers
```bash
export XCLAW_PROVIDER=openai   # or xai | openrouter | compatible
curl -s http://127.0.0.1:18790/providers | jq
```

## Isolation
```json
"channels": {
  "telegram": {
    "workspaceByChatId": { "111": "/data/a", "222": "/data/b" }
  }
}
```
