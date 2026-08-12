# WebSocket reconnect + exponential backoff

## Shared module

`src/utils/backoff.mjs` — strategies: **full** (default), equal, decorrelated, none.

`src/utils/ws-reconnect.mjs` — WS-oriented helpers:

```js
import { wsReconnectDelayMs, createWsReconnectScheduler } from "../utils/ws-reconnect.mjs";

const delay = wsReconnectDelayMs(attempt, { strategy: "full", baseMs: 1000, maxDelayMs: 30000 });
```

## Formula (full jitter)

```
cap = min(maxDelayMs, baseMs * 2^attempt)
delay ~ Uniform(0, cap)
```

## Control UI

`/control/` reconnect uses the same full-jitter formula (base 1s, max 30s).

## Server retries

`withBackoff` / `withExponentialBackoff` for API/tool retries (also respects Retry-After).
