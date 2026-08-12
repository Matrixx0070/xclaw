# Phase P4 complete (v3.1.0)

| Item | Status |
|------|--------|
| P4.1 Gateway auth + TLS | authStrict paths; HTTPS via XCLAW_TLS_CERT/KEY |
| P4.2 Slack Socket Mode | apps.connections.open + WebSocket when appToken set |
| P4.3 Imagine model matrix | src/media/imagine-models.mjs + XCLAW_IMAGE_MODELS |
| P4.4 Eval regression CI | npm run eval:regression |
| P4.5 Docker publish | Dockerfile + docs/PUBLISH.md |

## Gateway token

```bash
export XCLAW_GATEWAY_TOKEN=secret
# clients: Authorization: Bearer secret
```

## TLS

```bash
export XCLAW_TLS_CERT=/path/cert.pem
export XCLAW_TLS_KEY=/path/key.pem
```

## Slack Socket Mode

```json
"slack": {
  "enabled": true,
  "botToken": "xoxb-...",
  "appToken": "xapp-...",
  "socketMode": true
}
```

Full detail: [PHASES_P0_P4.md](./PHASES_P0_P4.md)
