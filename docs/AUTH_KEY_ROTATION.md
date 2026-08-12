# Automated key rotation strategies

P-256 (ES256) signing keys with dual-window verification.

## Strategies

| Strategy | Rotate when |
|----------|-------------|
| **ttl** | Age ≥ `maxAgeMs` |
| **budget** | Uses ≥ `maxUses` |
| **scheduled** | Age ≥ `intervalMs` |
| **dual_slot** | Manual / API only; keeps previous key for window |
| **hybrid** (default) | ttl **or** budget **or** scheduled |

## Dual window overlap

```text
──── current A ────┬──── current B ──────────────►  (all new signs)
                    │
                    └──── previous A (overlap) ──► validUntil
                         verify accepts A or B
```

| API | Role |
|-----|------|
| `getVerificationKeys` | current first, then previous if open |
| `closeDualWindow` | hard cutover (e.g. compromise) |
| `extendDualWindow` | ops lag; capped extension |
| `dualWindowStatus` | open / remainingMs / overlapRatio |
| `purgeExpiredPrevious` | auto-drop after validUntil |

Default overlap: **1h** (`dualWindowMs`). **Sign** always uses current; **verify** may use previous during overlap.

## API

```js
import {
  ensureKeyStore,
  maybeAutoRotate,
  rotateKeys,
  signWithCurrentKey,
  verifyWithRotatedKeys,
  closeDualWindow,
  extendDualWindow,
  dualWindowStatus,
} from "../src/auth/key-rotation.mjs";

await ensureKeyStore(cfg);
const { signature, kid } = await signWithCurrentKey(cfg, data);
await rotateKeys(cfg);
// old signature still verifies during overlap
await verifyWithRotatedKeys(cfg, data, signature);
await closeDualWindow(cfg); // optional hard cutover
```

## Config

```json
{
  "auth": {
    "keys": {
      "rotationStrategy": "hybrid",
      "maxAgeMs": 2592000000,
      "maxUses": 10000,
      "intervalMs": 604800000,
      "dualWindowMs": 3600000,
      "autoRotate": true,
      "secret": null
    }
  }
}
```

Env: `XCLAW_KEY_ROTATION`, `XCLAW_KEY_SECRET` (encrypts private JWK at rest).

## Store

`~/.xclaw/key-rotation.json` (mode 0600) — public JWK, encrypted private blob, previous slot, history.

## Automated scheduler

```js
import { installAutomatedKeyRotation } from "../src/auth/key-rotation-scheduler.mjs";

const ctrl = await installAutomatedKeyRotation(cfg, { intervalMs: 60_000 });
// ctrl.stop() / ctrl.runOnce() / ctrl.status()
```

```bash
xclaw keys status | evaluate | rotate | once
xclaw keys scheduler start [--interval 60000]
xclaw keys scheduler stop
xclaw keys recover
```

Paths: **timer** (interval) · **on sign** (budget) · **boot** (`installAutomatedKeyRotation`)

## Code

- `src/auth/key-rotation.mjs`  
- `src/auth/key-rotation-scheduler.mjs`  
- `src/cli/keys-cli.mjs`  
