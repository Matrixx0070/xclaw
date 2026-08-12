# Stream config knobs (`xclaw.json`)

```json
{
  "stream": {
    "capacity": 500,
    "ttlMs": 300000,
    "heartbeatMs": 15000,
    "backoff": "full",
    "baseMs": 1000,
    "maxMs": 30000,
    "maxResumeCycles": 5
  }
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `capacity` | `500` | Max events per `streamId` (ring buffer) |
| `ttlMs` | `300000` | GC delay after stream ends (5 min) |
| `heartbeatMs` | `15000` | SSE/NDJSON heartbeat interval (`0` = off) |
| `backoff` | `"full"` | Client resume jitter: `full` \| `equal` \| `decorrelated` \| `none` |
| `baseMs` | `1000` | Backoff base |
| `maxMs` | `30000` | Backoff cap |
| `maxResumeCycles` | `5` | CLI outer resume attempts |

## Environment overrides

| Env | Maps to |
|-----|---------|
| `XCLAW_STREAM_CAPACITY` | `stream.capacity` |
| `XCLAW_STREAM_TTL_MS` | `stream.ttlMs` |
| `XCLAW_STREAM_HEARTBEAT_MS` | `stream.heartbeatMs` |
| `XCLAW_STREAM_BACKOFF` | `stream.backoff` |
| `XCLAW_STREAM_BASE_MS` | `stream.baseMs` |
| `XCLAW_STREAM_MAX_MS` | `stream.maxMs` |

## Wiring

- **Gateway** — `resolveStreamResume` uses `capacity` / `ttlMs`; `createStreamWriter` uses `heartbeatMs`
- **CLI** — `xclaw run` inherits backoff defaults unless `--backoff` / `--base-ms` / `--max-ms` are set

```bash
# example
XCLAW_STREAM_CAPACITY=200 XCLAW_STREAM_TTL_MS=60000 xclaw gateway
xclaw run --ndjson "hello"   # uses stream.backoff from config
```
