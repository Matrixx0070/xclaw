# Native (thin) engine performance

> **Historical (pre-unification):** these benches compared the native thin server against the retired 16MB CDP bundle. Since ADR 0005 (2026-08-24) only the native engine exists; numbers kept for the record.

Measured on this host: 2026-08-17 (lab node). Numbers are order-of-magnitude guides, not SLAs.

## Footprint

| Engine | Entry size | RSS (steady) | Tools listed |
|--------|------------|--------------|--------------|
| **thin-native** | **~7.5 KB** (`thin-server.mjs`) | **~60 MB** | **7** (includes `xclaw_computer_act`) |
| **bundle** | **~16.1 MB** (`xclaw-server.mjs`) | **~170 MB** | **6** |

Thin is ~**3× smaller RSS** and ~**2000× smaller on disk** for the entry module.

## Latency (same machine, localhost HTTP)

| Metric | thin-native | bundle |
|--------|-------------|--------|
| Spawn → `/health` ready | ~1.9 s | ~1.6 s |
| `/health` p50 | ~0.7 ms | ~1.0 ms |
| Session create | ~4 ms | ~380 ms |
| `tools/list` | ~2 ms | ~6 ms |
| `xclaw_bash` echo p50 | ~6 ms | ~2 ms |

Notes:

- **Cold start** is dominated by Node process boot, not entry parse; both reach health in ~1.5–2 s here.
- Bundle **session create** was much slower in this run (~380 ms vs ~4 ms) — worth watching if agents create many sessions.
- Bundle **bash** micro-calls were slightly faster (amortized internals); both are negligible vs LLM RTTs (100s of ms–seconds).

## Capability vs speed

| Concern | Winner |
|---------|--------|
| Startup / memory / maintained `computer_act` | **thin-native** |
| Full historical BrowserService / skills surface inside one process | **bundle** (16MB artifact) |
| Agent-perceived speed (LLM + tools) | **Neither** — model latency dominates |

For lab/dev agent loops, **native is the better default**: lower RSS, explicit CUA tools, editable modules. Prod can keep bundle when the full in-process skill/browser surface is required.

## How to re-bench

```bash
node tmp-live/bench-computer.mjs
# or scripts equivalent once checked in
```

Env: legacy `XCLAW_COMPUTER_ENGINE` selectors all resolve to native (ADR 0005).

## Session reuse

Agent computer client can **reuse** sessions for the same `workingDir` (default on for native):

- `XCLAW_COMPUTER_REUSE_SESSION=1` force on
- `=0` force off
- `computer.reuseSession` in config
- Soft destroy keeps the session for the next `runAgent` in-process
- `XCLAW_COMPUTER_REUSE_HARD_DESTROY=1` forces HTTP destroy

Avoids repeated create cost (bundle ~380 ms create was the main outlier in benches).

- `XCLAW_COMPUTER_SESSION_TTL_MS` (default 30m) — pool/tools cache TTL; prune on createSession
