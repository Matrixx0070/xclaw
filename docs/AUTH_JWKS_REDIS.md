# JWKS Redis Pub/Sub transport

Optional fast fan-out for distributed JWKS invalidation.

## Design

```text
rotate / recover
  → epoch file++          (source of truth)
  → Redis PUBLISH         (wake live nodes)
  → webhooks              (optional)

subscriber
  → applyRemoteInvalidation
  → invalidateJwksCache
```

Missed Redis messages are safe: `getJwksCached` still checks the epoch file.

## Install

```bash
npm install redis
```

## Config

```json
{
  "auth": {
    "jwks": {
      "redis": {
        "enabled": true,
        "url": "redis://127.0.0.1:6379",
        "channel": "xclaw:jwks:invalidate"
      }
    }
  }
}
```

Env:

- `XCLAW_JWKS_REDIS=1`
- `XCLAW_REDIS_URL` / `REDIS_URL`
- `XCLAW_JWKS_REDIS_CHANNEL`

## API

```js
import {
  startJwksRedisSubscriber,
  stopJwksRedisSubscriber,
  jwksRedisStatus,
} from "../src/auth/jwks-redis-pubsub.mjs";

// On gateway boot:
await startJwksRedisSubscriber(cfg);

// publishJwksInvalidation() already publishes when redis.enabled
```

## Channel payload

```json
{
  "type": "jwks_invalidation",
  "epoch": 7,
  "generation": 3,
  "kid": "...",
  "id": "...",
  "reason": "rotate"
}
```

## Code

`src/auth/jwks-redis-pubsub.mjs`
