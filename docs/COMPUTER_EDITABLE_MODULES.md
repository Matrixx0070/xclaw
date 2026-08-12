# Computer editable modules (the A1 “win”)

## Goal

Treat **XClaw computer server** as the source — but **edit clean modules**, not the 16.8MB blob by hand.

## What we extracted from `xclaw-server.mjs`

| Module | Path | Status |
|--------|------|--------|
| **BrowserService** | `src/computer/browser-service.mjs` | **Clean, syntax-checked, importable** class |
| **xclaw_browser_tab** (text) | `src/computer/browser-tab-tool.extracted.mjs` | Reference extract; still needs bundle helpers |

### `browser-service.mjs` owns

- `getChromePath()`
- `ensureRunning()` — profile, lock, args, spawn, CDP wait
- `connectBrowserClient()`
- `withTab()` / `allocateTabId()`
- `stop()` / `stopSync()`
- orphan Chrome cleanup

Outer bundle symbols (`log_default`, `path3`, `mkdtemp`, …) were rewritten to **standard Node imports**.

### Runtime truth (important)

Today the **computer process still runs the inlined copy** inside `xclaw-server.mjs`.

```text
Edit:   src/computer/browser-service.mjs     ← do work here
Run:    src/computer/xclaw-server.mjs        ← still the entry (bundle)
```

**Phase A2** either:

1. Patches the bundle to `import { BrowserService } from "./browser-service.mjs"`, or  
2. Syncs edits from the clean module back into the bundle with a script, or  
3. Replaces entry with a thin server that composes clean modules + remaining bundle tools.

Until then: **clean module is the source of truth for development; bundle is the process image.**

## Lineage

Same class as `/app/grok-computer-server.mjs` (Grok). XClaw = rebrand + Horizon patches on that BrowserService region.

## How to verify

```bash
node --check src/computer/browser-service.mjs
node -e "import { BrowserService } from './src/computer/browser-service.mjs'; console.log(typeof BrowserService)"
```
