# Swarm HTTP API (Phase D)

First-class gateway routes for multi-agent swarm runs (no need to go through agent tools).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/swarm/run` | token | Start fan-out / DAG swarm |
| GET | `/swarm` | token | List recent runs |
| GET | `/swarm/:id` | token | Get run by id |
| GET | `/swarm/merges` | token | List merge proposals |
| GET | `/swarm/merges/:id` | token | Get proposal |
| POST | `/swarm/merges/:id/approve` | token | Approve apply |
| POST | `/swarm/merges/:id/reject` | token | Reject proposal |
| GET | `/subagents` | token | List persisted subagents |

## POST /swarm/run body

```json
{
  "goal": "Ship feature X",
  "tasks": [
    { "id": "r1", "role": "research", "task": "Survey existing code" },
    { "id": "i1", "role": "implement", "task": "Implement change", "dependsOn": ["r1"] },
    { "id": "v1", "role": "verify", "task": "Run checks", "dependsOn": ["i1"] }
  ],
  "onDepFail": "skip-downstream",
  "vote": false,
  "merge": false
}
```

Roles: `research` | `implement` | `verify` | `critic`

## Examples

```bash
curl -s -X POST -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"goal":"demo","tasks":[{"id":"a","role":"research","task":"summarize README"}]}' \
  http://127.0.0.1:4243/swarm/run

curl -s -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" \
  http://127.0.0.1:4243/swarm | jq .
```


## POST /swarm/run/stream (SSE)

Same body as `/swarm/run`. Response is `text/event-stream`.

### Events

| event | when |
|-------|------|
| `lifecycle` | connection start |
| `swarm_start` | run persisted |
| `wave_start` | each topological wave |
| `child_start` | node begins |
| `child_retry` | retry backoff |
| `child_done` | node finished |
| `child_skipped` | dependency failure skip |
| `swarm_done` | all nodes terminal |
| `result` | final payload (summary, graph, merge, vote) |
| `error` | preflight or runtime failure |
| `done` | stream closed |

Client disconnect aborts the swarm via `AbortSignal`.

```bash
curl -N -X POST -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"goal":"demo","tasks":[{"id":"a","role":"research","task":"scan"}]}' \
  http://127.0.0.1:4243/swarm/run/stream
```


## Abort / client disconnect

`POST /swarm/run/stream` binds an `AbortController` via `bindSSEAbort`:

- `req/res` `close` / `error` / `aborted` → `controller.abort(Error)`
- 15s heartbeat; failed write → abort
- `signal` passed into `runSwarmFanOut` and each subagent spawn
- Between waves: if aborted → remaining nodes `skipped`, run status **`aborted`**
- SSE events: `swarm_aborted`, then `result` with `aborted: true`

`isAbortError(err, signal)` in `src/gateway/sse.mjs` normalizes detection.
