# Exponential backoff

Module: `src/utils/backoff.mjs`

## Formulas

| Name | Formula |
|------|---------|
| **Pure exponential** (`none`) | `min(max, base × 2^attempt)` |
| **Full jitter** (default) | `U(0, min(max, base × 2^attempt))` |
| **Equal jitter** | `half + U(0, half)` where `half = exp/2` |
| **Decorrelated** | `U(base, min(max, prev × 3))` |

Attempt is **0-based**. Delays clamp to `[0, maxDelayMs]`.

## API

```js
import {
  exponentialBackoffMs,
  fullJitterBackoffMs,
  createBackoff,
  withBackoff,
  withExponentialBackoff,
  parseRetryAfterMs,
} from "../utils/backoff.mjs";

// Single delay
exponentialBackoffMs(3, { baseMs: 200, maxDelayMs: 30_000 }); // 1600
fullJitterBackoffMs(3, { baseMs: 200 }); // 0..1600

// Stateful sleeper (decorrelated needs prev)
const b = createBackoff({ strategy: "full", baseMs: 200 });
await b.sleep(0, signal);

// Retry wrapper
await withExponentialBackoff(() => fetch(url), {
  retries: 3,
  baseMs: 200,
  strategy: "full",       // default
  respectRetryAfter: true,
  signal,
});
```

## SSE reconnect

`reconnectDelayMs` in `sse-reconnect.mjs` delegates to `fullJitterBackoffMs` (base 1s, max 30s).

## HTTP Retry-After

When present on 429/503 errors, server hint wins (optional small extra jitter), still capped by `maxDelayMs`.
