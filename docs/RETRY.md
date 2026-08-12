# XClaw retry & jitter

Transport-level retries for the **provider** (chat completions) and **computer client** (session/tool HTTP).

## Config (`~/.xclaw/xclaw.json`)

```json
{
  "retry": {
    "retries": 3,
    "baseMs": 200,
    "maxDelayMs": 30000,
    "strategy": "full",
    "respectRetryAfter": true,
    "retryAfterJitterRatio": 0.1,
    "log": true
  }
}
```

| Field | Meaning |
|-------|---------|
| `retries` | Max sleeps after the first failure (0–20) |
| `baseMs` | Base delay scale |
| `maxDelayMs` | Cap **per sleep** (including Retry-After) |
| `strategy` | `full` \| `equal` \| `decorrelated` \| `none` |
| `respectRetryAfter` | Prefer server `Retry-After` when present |
| `retryAfterJitterRatio` | Extra random fraction on top of Retry-After (desync) |
| `log` | Console warn on each retry |

## Strategies

| Strategy | Delay |
|----------|--------|
| **full** (default) | Uniform in `[0, min(cap, base·2^attempt)]` |
| **equal** | Half expo + uniform in the other half |
| **decorrelated** | Uniform in `[base, min(cap, 3·prev)]` |
| **none** | Pure exponential (tests / debug) |

## Retry-After

On HTTP 429/503 (and other errors that include the header), XClaw:

1. Parses delta-seconds or HTTP-date
2. Sleeps that duration (+ optional ratio jitter)
3. Clamps to `maxDelayMs`
4. Falls back to `strategy` if the header is missing/invalid

## Events

Agent loop may emit:

```json
{ "type": "retry", "target": "provider", "attempt": 1, "retries": 3, "delayMs": 500, "strategy": "full" }
```

## What is not retried

- Non-transient 4xx (e.g. 400) without Retry-After
- AbortSignal cancellation
- Tool *logic* errors returned as HTTP 200 + `isError` payload
- Semantic tool loops (handled by loop guards, not transport retry)
