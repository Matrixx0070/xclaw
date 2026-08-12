# Custom Abort Handlers

Module: `src/utils/abort-handlers.mjs` (also re-exported from `src/gateway/sse.mjs`).

## API

| Export | Purpose |
|--------|---------|
| `onAbort(signal, handler, opts?)` | Register cleanup; returns unsubscribe |
| `AbortScope` | Ordered multi-handler scope (default **LIFO**) |
| `withAbortScope(signal, fn)` | Run work with scope; dispose after |
| `linkAbort(parent, childController)` | Parent abort → child abort |
| `anySignal(signals[])` | Combined signal |
| `toAbortError(reason)` | Normalize reason to `Error` |

### Handler options

- `once` (default true)
- `label` — diagnostics
- `timeoutMs` — max async cleanup time

### Example

```js
import { onAbort, AbortScope, linkAbort } from "../gateway/sse.mjs";

const ac = new AbortController();
onAbort(ac.signal, async ({ reason }) => {
  await flushLogs(reason);
}, { label: "flush", timeoutMs: 3000 });

const child = new AbortController();
linkAbort(ac.signal, child);

const scope = new AbortScope(ac.signal);
scope.onAbort(() => worker.kill(), { label: "worker" });
scope.onAbort(() => tempDir.rm(), { label: "tmpdir" });
```

### Swarm SSE

`POST /swarm/run/stream` registers a custom handler that **persists** `status: "aborted"` on the swarm run when the client disconnects (if `swarmId` was already known).
