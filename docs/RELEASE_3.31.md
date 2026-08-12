# XClaw 3.31.0 — Release checklist (X2)

## Version
- package.json: **3.31.0**
- Codename focus: admission control (X1) + prior SSE/abort/IMM stack

## Included since 3.27+
- [x] Control UI swarm panel (D3)
- [x] SSE reconnect + Last-Event-ID (eviction)
- [x] Exponential backoff unified API
- [x] AbortSignal.any / timeout helpers
- [x] IMM filter (1D)
- [x] **X1 Admission**: maxDepth, maxWaitMs, concurrency, QED staffing helper
- [x] GET /queue/admission

## Verify before ship
- [ ] `node --test test/admission.test.mjs`
- [ ] `node --test test/abort-handlers.test.mjs`
- [ ] `node --test test/sse-reconnect.test.mjs`
- [ ] `node --test test/imm-filter.test.mjs`
- [ ] Gateway boots: `node bin/xclaw.mjs gateway` (or npm start)
- [ ] `GET /queue/stats` returns admission block

## Install
See INSTALL.md — Node 20+ recommended.

## Config snippet (queue policy)
```json
{
  "queue": {
    "concurrency": 2,
    "maxDepth": 50,
    "maxWaitMs": 120000,
    "maxConcurrencyCap": 8
  }
}
```
