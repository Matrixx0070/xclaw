# Computer Strategy C — Bundle is runtime, modules are source

**Status:** C1 (policy + build stub) — 2026-08-12

## Rule

| Artifact | Role |
|----------|------|
| `src/computer/modules/**` | **Source of truth** — all feature work |
| `src/computer/chrome-args.mjs`, bridges, thin tools | **Source** — edit freely |
| `src/computer/xclaw-server.mjs` (~16MB) | **Runtime only** — **do not hand-edit** |
| `src/computer/thin-server.mjs` | Lab/debug fallback until full module→bundle build is complete |

## Why

- Full CDP / BrowserService lives in the historical bundle.
- Hand-editing 16MB causes dual-engine drift and unreviewable diffs.
- Strategy C: **edit modules → `npm run build:computer` → run bundle**.

## Commands

```bash
# Validate modules + policy (C1 — does not yet re-emit full 16MB from source)
npm run build:computer

# Prefer bundle runtime (when ready)
XCLAW_COMPUTER_ENGINE=bundle node bin/xclaw.mjs ...

# Lab thin (current transitional default)
XCLAW_COMPUTER_ENGINE=native  # or omit
```

## Phases

| Phase | Work |
|-------|------|
| **C1** | Policy, MODULE_MAP check, build stub, tests — **this doc** |
| **C2** | Promote `.extracted.mjs` → maintained modules; shared registry |
| **C3** | Real esbuild entry; regenerate `xclaw-server.mjs` |
| **C4** | Bundle becomes default engine; thin debug-only |
| **C5** | CI fails if bundle older than sources / markers missing |

## Do not

- Patch features only inside `xclaw-server.mjs`
- Treat thin and bundle as two equal long-term products
- Commit hand-edits to the blob without a MODULE_MAP note

See also: `SOURCE_OF_TRUTH.json`, `MODULE_MAP.json`.
