# Exponential backoff strategies (XClaw)

Shared implementation: `src/utils/backoff.mjs`  
CLI: `xclaw run --backoff <strategy>`  
Shell: `XCLAW_BACKOFF=... scripts/xclaw-run-with-retry.sh`

## Strategies

| Strategy | Formula (attempt `a`, 0-based) | Best for |
|----------|--------------------------------|----------|
| **`full`** (default) | `U(0, min(max, base·2^a))` | General retries; avoids thundering herd |
| **`equal`** | `half + U(0, half)` where `half = exp/2` | Keeps a minimum wait; less aggressive than full |
| **`decorrelated`** | `U(base, min(max, prev·3))` | Adaptive; smooths when latency varies |
| **`none`** | `min(max, base·2^a)` | Tests / deterministic schedules |

All delays are clamped to `[0, maxMs]`.

## CLI

```bash
xclaw run --backoff full --base-ms 1000 --max-ms 30000 "hello"
xclaw run --backoff decorrelated --resume "$ID" --last-event-id "$LAST"
xclaw run --backoff none --base-ms 200   # deterministic (tests)
```

These flags feed the **outer** resume loop in `createResumingStreamClient` (`strategy`, `baseMs`, `maxMs`).

## Shell retry wrapper

```bash
XCLAW_BACKOFF=full         ./scripts/xclaw-run-with-retry.sh "hello"
XCLAW_BACKOFF=decorrelated XCLAW_MAX_TRIES=8 ./scripts/xclaw-run-with-retry.sh --resume "$ID"
XCLAW_BACKOFF=none XCLAW_BASE_MS=500 ./scripts/xclaw-run-with-retry.sh "smoke"
```

Only **exit code 7** (transient) is retried; see `docs/cli-run-exit-codes.md`.

## JavaScript

```js
import {
  computeJitterDelay,
  createBackoff,
  resolveJitterStrategy,
  JITTER_STRATEGIES,
} from "../src/utils/backoff.mjs";

// One-shot
const ms = computeJitterDelay("full", 3, { baseMs: 1000, maxDelayMs: 30000 });

// Stateful (decorrelated tracks prevDelay)
const b = createBackoff({ strategy: "decorrelated", baseMs: 1000, maxDelayMs: 30000 });
const d0 = b.delayMs(0);
const d1 = b.delayMs(1);
await b.sleep(2); // respects AbortSignal if passed
```

### Retry-After

`createBackoff({ respectRetryAfter: true })` prefers HTTP `Retry-After` (seconds or HTTP-date) when the error carries it, then clamps to `maxDelayMs`, with optional small jitter.

## Choosing a strategy

1. **Default production:** `full` — simple, herd-safe  
2. **Many clients on same failure:** `full` or `decorrelated`  
3. **Want floor latency between tries:** `equal`  
4. **Tests / replay:** `none`  

## Math notes

- Cap `2^attempt` growth via `maxMs` so schedules cannot explode.  
- Decorrelated uses **previous delay**, not attempt index, so a long wait pulls the next sample up.  
- Full jitter expected delay ≈ `exp/2`, so it is faster on average than pure exponential (`none`).
