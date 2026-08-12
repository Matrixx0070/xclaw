# JWKS HTTP API (Gateway)

## Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/xclaw/jwks.json` | Public JWKS document |
| GET | `/.well-known/jwks.json` | Alias |
| GET | `/jwks.json` | Short alias |

Headers: `ETag`, `Cache-Control`, `X-XClaw-Key-Generation`, `X-XClaw-Key-Kid`  
Query: `?force=1` bypasses cache and re-exports from key store.

## Operator (gateway token when configured)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/xclaw/jwks/epoch` | Invalidation epoch document |
| POST | `/xclaw/jwks/invalidate` | Publish or apply remote invalidation |
| GET | `/xclaw/jwks/cache` | Cache / epoch status summary |

### POST body

- Local publish: `{ "reason": "manual" }`
- Peer apply: `{ "type": "jwks_invalidation", "epoch": N, "id": "...", ... }`

## Example

```bash
curl -s http://127.0.0.1:4243/xclaw/jwks.json | jq .
curl -s -X POST -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"ops"}' \
  http://127.0.0.1:4243/xclaw/jwks/invalidate
```
