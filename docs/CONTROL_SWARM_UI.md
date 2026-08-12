# D3 — Control UI · Swarm panel

Served at **`/control/`** (static from `ui/control/`).

## Features

| Control | API |
|---------|-----|
| List swarm runs | `GET /swarm?limit=40` |
| View run detail | `GET /swarm/:id` |
| List merge proposals | `GET /swarm/merges` |
| Approve merge | `POST /swarm/merges/:id/approve` |
| Reject merge | `POST /swarm/merges/:id/reject` |
| Run (sync JSON) | `POST /swarm/run` |
| Run + live SSE | `POST /swarm/run/stream` |
| Abort stream | browser `AbortController` → server `bindSSEAbort` |

## UI

- Goal + optional tasks JSON (defaults to a 2-node research→writer graph)
- Live event log (`swarm_start`, `wave_start`, `swarm_done`, `swarm_aborted`, …)
- Merge approve/reject for `pending` / `proposed` rows

## Auth

If gateway token is required, open `/control/` from a session that already sends the token (or use browser extensions). Same-origin fetches use cookies/headers configured for the gateway.
