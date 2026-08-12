# Idempotency keys

## Purpose

Safe retries for mutating ops (rotate, recovery playbooks, JWKS invalidation apply, webhooks).

## API

```js
import {
  withIdempotency,
  beginIdempotent,
  completeIdempotent,
  failIdempotent,
  idempotencyKeyFromEvent,
} from "../src/auth/idempotency.mjs";

const result = await withIdempotency(cfg, "recover:incident-123", async () => {
  return recoverFromCompromise(cfg, { reason: "incident-123" });
});
// Second call with same key returns stored result; fn not run again.
```

### Begin / complete

```js
const b = await beginIdempotent(cfg, key, { request: { ... } });
if (!b.fresh) return b.result;
try {
  const result = await doWork();
  await completeIdempotent(cfg, key, result);
  return result;
} catch (e) {
  await failIdempotent(cfg, key, e);
  throw e;
}
```

## Fingerprints

Optional `request` / `fingerprint` binds the key to a payload hash. Reusing the same key with a different body → `FINGERPRINT_MISMATCH`.

## In-progress policy

| `onInProgress` | Behavior |
|----------------|----------|
| `reject` (default) | Second caller gets `IN_PROGRESS` |
| `wait` | Poll until completed or timeout |

## Event keys

```js
const key = idempotencyKeyFromEvent({
  id: "a1b2c3d4",
  type: "jwks_invalidation",
  epoch: 12,
});
// → "evt:a1b2c3d4" or hash if no id
```

## Config

```json
{
  "auth": {
    "idempotency": {
      "ttlMs": 86400000,
      "maxRecords": 5000,
      "onInProgress": "reject",
      "waitTimeoutMs": 30000
    }
  }
}
```

Store: `~/.xclaw/idempotency.json` (0600)

## Code

`src/auth/idempotency.mjs`
