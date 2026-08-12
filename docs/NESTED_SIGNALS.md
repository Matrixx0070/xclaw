# Nested AbortSignals

Module: `src/utils/abort-handlers.mjs`

## `createNestedSignal(parent, opts?)`

Creates a **child** controller that aborts when:

1. **Parent** aborts (one-way — child does not abort parent)
2. Optional **timeout** (`timeoutMs`)
3. Local **`nest.abort(reason)`**

```js
const nest = createNestedSignal(reqSignal, { timeoutMs: 30_000 });
try {
  await work({ signal: nest.signal });
} finally {
  nest.dispose(); // unlink listeners / clear timeout polyfill
}
```

| Field | Meaning |
|-------|---------|
| `signal` | Pass downstream |
| `controller` | Local AbortController |
| `dispose()` | Detach parent/timeout links |
| `sources` | e.g. `["local","parent","timeout"]` |
| `abort(reason)` | Abort child only |

## `createNestedScope(parent, opts?)`

`AbortScope` + nested signal. Dispose tears down both.

## `timeoutSignal(ms)` / `anySignal(signals)`

Use native `AbortSignal.timeout` / `AbortSignal.any` when present; otherwise polyfill.

## Subagents

`spawnSubagent` uses `createNestedSignal(parent, { timeoutMs })` so parent SSE abort and per-child timeout both cancel the child loop.


## `abortSignal(reason)` / `abort(controller, reason)`

Spec-aligned helpers:

```js
import { abortSignal, abort } from "../utils/abort-handlers.mjs";

// Already-aborted signal (AbortSignal.abort)
const signal = abortSignal(new Error("cancelled"));

// Safe controller abort
const ac = new AbortController();
abort(ac, "client_close"); // true
abort(ac, "again");        // false — already aborted
```


## `abortSignalAny(iterable)` — AbortSignal.any

Spec-aligned composite signal:

```js
import { abortSignalAny, anySignal, installAbortSignalAny } from "../utils/abort-handlers.mjs";

const signal = abortSignalAny([user.signal, AbortSignal.timeout(5000)]);
// or library wrapper with dispose:
const { signal, dispose } = anySignal([a, b]);

// Optional global polyfill if runtime lacks AbortSignal.any:
installAbortSignalAny();
```

- Empty list → never aborts  
- First aborted input’s **reason** is copied as-is  
- Prefers native `AbortSignal.any` when available  


## `abortSignalTimeout(ms)` — AbortSignal.timeout

```js
import {
  abortSignalTimeout,
  timeoutSignal,
  createTimeoutError,
  installAbortSignalTimeout,
} from "../utils/abort-handlers.mjs";

const signal = abortSignalTimeout(5_000);
// reason.name === "TimeoutError" (DOMException when available)

// soft wrapper with dispose (polyfill clears timer):
const { signal: s, dispose } = timeoutSignal(5_000);

installAbortSignalTimeout(); // only if global missing
```

- Prefer native `AbortSignal.timeout`
- Polyfill: `setTimeout` + `createTimeoutError` + `unref`
- `ms === 0` → abort ASAP
- Invalid `ms` → `TypeError` (strict API)
