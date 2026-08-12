# Decorrelated jitter backoff

AWS “decorrelated jitter” (preferred for long-lived reconnect loops):

```
delay ~ Uniform(baseMs, min(maxDelayMs, 3 * prevDelayMs))
```

Unlike full jitter (which depends only on attempt index), **prev** couples successive delays so clients desynchronize without all climbing the same exponential ladder.

## API

```js
import { decorrelatedBackoffMs, createBackoff } from "../utils/backoff.mjs";
import { createWsReconnectScheduler } from "../utils/ws-reconnect.mjs";

let prev = 200;
const d = decorrelatedBackoffMs(0, { baseMs: 200, maxDelayMs: 30000, prevDelayMs: prev });
prev = d;

// stateful
const sched = createWsReconnectScheduler({ strategy: "decorrelated", baseMs: 1000 });
sched.nextDelay(); // tracks prev internally
```

## Defaults

| Surface | Strategy |
|---------|----------|
| `withBackoff` | full |
| `ws-reconnect` scheduler | **decorrelated** |
| Control UI WS reconnect | **decorrelated** |

## Why for WebSocket

After mass disconnects, pure exponential + full jitter still correlates on attempt index. Decorrelated uses each client’s last sleep, spreading retries more aggressively over time.
