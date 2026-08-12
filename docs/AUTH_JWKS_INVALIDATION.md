# Distributed JWKS cache invalidation

## Problem

With TTL-only caches, after key rotation or compromise recovery other processes/nodes may keep serving **stale JWKS** until TTL expires.

## Mechanisms

| Channel | Scope |
|---------|--------|
| **Epoch file** | Multi-process / shared volume (`jwks-invalidation-epoch.json`) |
| **Generation bind** | Cache stores key generation; mismatch forces refresh |
| **In-process listeners** | `onJwksInvalidation(fn)` |
| **Webhooks** | POST to peer URLs (`auth.jwks.invalidationWebhooks`) |

## Flow

```text
Node A: rotateKeys / recover
   → publishJwksInvalidation()  (epoch++)
   → invalidate local JWKS cache
   → warm cache

Node B: getJwksCached()
   → checkJwksInvalidation()
   → if epoch > cache.invalidationEpoch → force refresh
```

## API

```js
import {
  publishJwksInvalidation,
  checkJwksInvalidation,
  applyRemoteInvalidation,
  onJwksInvalidation,
} from "../src/auth/jwks-invalidation.mjs";

await publishJwksInvalidation(cfg, {
  reason: "rotate",
  generation: 3,
  kid: "xclaw-es256-g3-...",
});

// Peer receives webhook body and applies:
await applyRemoteInvalidation(cfg, payload);
```

`rotateKeys` and `refreshJwksAfterRotation` already publish invalidation.

## Config

```json
{
  "auth": {
    "jwks": {
      "distributedInvalidation": true,
      "invalidationWebhooks": [
        "http://peer:4243/xclaw/jwks/invalidate"
      ],
      "invalidationWebhookTimeoutMs": 3000
    }
  }
}
```

Env: `XCLAW_JWKS_INVALIDATION_WEBHOOKS=url1,url2`

## HTTP (gateway)

```text
GET  /xclaw/jwks/invalidation-epoch
POST /xclaw/jwks/invalidate     — publish local or apply remote body
```

Use `handleInvalidationHttp(cfg, method, body)`.

## Files

- `~/.xclaw/jwks-invalidation-epoch.json` — shared epoch
- `~/.xclaw/jwks-cache.json` — includes `invalidationEpoch` after refresh

## Code

`src/auth/jwks-invalidation.mjs` · integrated in `src/auth/jwks.mjs`
