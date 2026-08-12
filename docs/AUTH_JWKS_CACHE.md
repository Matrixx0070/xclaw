# JWKS caching strategy

## Export

```js
import { exportJwks, getJwksCached, findJwkByKid } from "../src/auth/jwks.mjs";

const { jwks, etag, generation, dualWindowOpen } = await exportJwks(cfg);
// jwks = { keys: [ { kty, crv, x, y, kid, use, alg }, ... ] }
```

Keys come from the rotation allow list (current + dual-window previous). Revoked kids are filtered out when recovery state is available.

## Cache strategies

| Strategy | Behavior |
|----------|----------|
| **ttl** | Refresh when age ≥ `cacheTtlMs` |
| **unknown_kid** | Refresh when requested `kid` is not in cache |
| **stale_revalidate** | Serve stale up to `maxStaleMs` while refreshing |
| **hybrid** (default) | unknown_kid + TTL + soft stale window |

```text
fetchedAt
  ├──── cacheTtlMs ──────────► fresh (cache hit)
  ├──── + maxStaleMs ────────► stale_revalidate
  └──── beyond ──────────────► hard refresh
```

## API

```js
await getJwksCached(cfg);
await getJwksCached(cfg, { force: true });
await getJwksCached(cfg, { kid: "xclaw-es256-g3-..." });
await findJwkByKid(cfg, kid);
await invalidateJwksCache(cfg);
await refreshJwksAfterRotation(cfg); // after rotate / recovery
```

Optional remote:

```js
await getJwksCached(cfg, {
  fetcher: async () => {
    const res = await fetch(url);
    return { jwks: await res.json(), etag: res.headers.get("etag") };
  },
});
```

## Config

```json
{
  "auth": {
    "jwks": {
      "cacheStrategy": "hybrid",
      "cacheTtlMs": 300000,
      "maxStaleMs": 1800000,
      "filterRevoked": true
    }
  }
}
```

Env: `XCLAW_JWKS_CACHE`  
File: `~/.xclaw/jwks-cache.json` (0600)

## CLI

```bash
xclaw keys jwks export
xclaw keys jwks cache [--force] [--kid ...]
xclaw keys jwks invalidate
xclaw keys jwks refresh
xclaw keys jwks find --kid ...
xclaw keys jwks strategies
```

## Code

`src/auth/jwks.mjs`
