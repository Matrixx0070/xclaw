# Computer Strategy C — Bundle-default + modules as source

**Status:** D1–D4 **bundle is the product default** (2026-08-15)

| Runtime | Role |
|---------|------|
| **bundle** (`xclaw-server.mjs` ~16.8MB) | **DEFAULT** — full CDP computer |
| **native / generated** | Lightweight **escape hatch** only |
| **modules/** | Where new features are developed (never hand-edit the blob) |

**Do not hand-edit** the 16MB file. Ship power via module sidecars or a **new published blob** (sha256 + `fetch:bundle`).


## Rule

| Artifact | Role |
|----------|------|
| `src/computer/modules/**` | **Source of truth** — all feature work |
| `src/computer/chrome-args.mjs`, bridges, thin tools | **Source** — edit freely |
| `src/computer/xclaw-server.mjs` (~16MB) | **Runtime only** — **do not hand-edit**; fallback engine |
| `src/computer/thin-server.mjs` | Default engine entry until C4 soak complete |
| `src/computer/generated/computer-server.mjs` | C3 esbuild output — do not hand-edit |
| `src/computer/PARITY_MATRIX.json` | **C4** tool × engine status (CI-enforced) |

## Why

- Full CDP / BrowserService lives in the historical bundle.
- Hand-editing 16MB causes dual-engine drift and unreviewable diffs.
- Strategy C: **edit modules → `npm run build:computer` → prefer native/generated**.
- **Do not delete** the 16MB blob until parity + soak say so.

## Commands

```bash
# Validate modules + emit generated server (C3)
npm run build:computer

# C4 parity gate (matrix + registry + no defaultPath missing on native)
npm run check:computer-parity

# Prefer bundle runtime (explicit fallback only)
XCLAW_COMPUTER_ENGINE=bundle node bin/xclaw.mjs ...

# Default / lab thin
XCLAW_COMPUTER_ENGINE=native  # or omit
```

## Phases

| Phase | Work | Status |
|-------|------|--------|
| **C1** | Policy, MODULE_MAP check, build stub, tests | done |
| **C2** | Promote `.extracted.mjs` → maintained modules; shared registry | done |
| **C3** | Real esbuild entry → `generated/computer-server.mjs` | done |
| **C4** | Parity matrix + CI; close defaultPath gaps; soak native | **in progress** |
| **C5** | CI fails if sources drift without rebuild; optional deprecation of blob | pending |

## C4 rules

1. Every `MAINTAINED_TOOLS` name must appear in `PARITY_MATRIX.json`.
2. Tools with `defaultPath: true` must not have `native: "missing"`.
3. `policy.defaultEngine` must not be `bundle` while C4 is active.
4. `xclaw-server.mjs` is retained as `fallbackEngine` — never hand-edit.

## Do not

- Patch features only inside `xclaw-server.mjs`
- Treat thin and bundle as two equal long-term products
- Commit hand-edits to the blob without a MODULE_MAP note
- Delete the 16MB file to "finish" Strategy C

See also: `SOURCE_OF_TRUTH.json`, `MODULE_MAP.json`, `PARITY_MATRIX.json`.

## C2 (done)

- `modules/registry.mjs` — maintained tool registry
- `bundle-entry.mjs` — future esbuild entry stub
- `native-tools.mjs` → registry
- `*.extracted.mjs` = reference only
- `npm run build:computer` checks maintained + extracted

## C3 (done)

- `npm run build:computer` runs **esbuild** → `src/computer/generated/computer-server.mjs`
- **Does not overwrite** `xclaw-server.mjs` (16MB CDP)
- Engine: `XCLAW_COMPUTER_ENGINE=generated`
- Manager starts generated entry when selected

## C4 (this commit)

- `PARITY_MATRIX.json` — tool capability matrix
- `npm run check:computer-parity` — CI gate
- `describeComputerEngine()` — status/doctor observability
