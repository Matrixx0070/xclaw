# Computer Strategy C — Bundle is runtime, modules are source

**Status:** C3 (generated emit) — 2026-08-12

## Rule

| Artifact | Role |
|----------|------|
| `src/computer/modules/**` | **Source of truth** — all feature work |
| `src/computer/chrome-args.mjs`, bridges, thin tools | **Source** — edit freely |
| `src/computer/xclaw-server.mjs` (~16MB) | **Runtime only** — **do not hand-edit** |
| `src/computer/generated/computer-server.mjs` | **Generated** from modules via esbuild (C3) |
| `src/computer/thin-server.mjs` | Lab/debug until C4 |

## Commands

```bash
npm run build:computer
XCLAW_COMPUTER_ENGINE=generated   # modules-built server
XCLAW_COMPUTER_ENGINE=bundle      # full CDP 16MB
# default lab: native/thin
```

## Phases

| Phase | Work |
|-------|------|
| C1 | Policy, MODULE_MAP check |
| C2 | Maintained registry |
| C3 | esbuild → generated/ (16MB NOT overwritten) |
| C4 | Default engine flip |
| C5 | CI: bundle/generated freshness |
