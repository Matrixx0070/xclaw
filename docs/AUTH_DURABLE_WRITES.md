# Durable atomic writes

## Sequence (tier 4)

```text
mkdir dir (0700)
open tmp (0600)
write full payload
fsync(tmp)          // data durable
close
rename(tmp → final) // atomic visibility
fsync(dir)          // rename durable
chmod 0600
```

## Module

`src/utils/durable-write.mjs`

```js
import { durableAtomicWriteJson, durableWritesEnabled } from "../utils/durable-write.mjs";

await durableAtomicWriteJson(path, obj, { durable: true });
```

## Wired stores

| Store | Module |
|-------|--------|
| `key-rotation.json` | `key-rotation.mjs` |
| `key-recovery.json` | `key-compromise-recovery.mjs` |
| `jwks-invalidation-epoch.json` | `jwks-invalidation.mjs` |
| `jwks-cache.json` | `jwks.mjs` |
| `idempotency.json` | `idempotency.mjs` |

## Disable

```json
{ "auth": { "durableWrites": false } }
```

Env: `XCLAW_DURABLE_WRITES=0`

When disabled, falls back to rename-only (tier 2) for speed.
