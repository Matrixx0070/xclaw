# SSE reconnect

## Client (control UI eviction stream)

- Exponential backoff with full jitter (1s base → 30s max)
- Tracks `lastEventId` from EventSource messages
- Reconnect URL: `/events/eviction/stream?lastEventId=…`

## Server

- Each eviction event sent with `id: <entry.id>`
- `Last-Event-ID` header **or** `?lastEventId=` → replay only newer buffer entries
- Ring buffer size: 100

## Helpers (`src/utils/sse-reconnect.mjs`)

| Export | Role |
|--------|------|
| `eventsAfterLastId` | Ring-buffer resume slice |
| `reconnectDelayMs` | Jittered backoff |
| `formatSSEEvent` | `id` + `event` + `data` framing |
| `createEventSourceReconnect` | Optional EventSource controller |

## POST streams (agent/swarm)

One-shot runs are not resumed mid-flight. Client abort stops work; start a new run or poll `GET /swarm/:id`.
