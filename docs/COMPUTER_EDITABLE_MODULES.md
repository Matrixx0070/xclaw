# Computer editable modules (the A1 "win")

## Goal

Treat **XClaw computer server** as the source — but **edit clean modules**, not the 16.8MB blob by hand.

## Current state (post-Strategy C)

The maintained tool modules live in `src/computer/modules/` (bash, file read/write/edit, browser_tab, registry) and are consumed by:

- `src/computer/xclaw-server.mjs` — the single **bundle** engine (ADR 0006),
  which bridges into them via `loadNativeMergeModule` (thin-server.mjs and the
  generated engine are both deleted)

| Module | Path | Status |
|--------|------|--------|
| **xclaw_browser_tab** (native) | `src/computer/modules/browser-tab-tool.mjs` | Maintained — SSRF-guarded fetch, tabs, extraction |
| **xclaw_browser_tab** (text) | `src/computer/browser-tab-tool.extracted.mjs` | Historical reference extract |

### Removed: `browser-service.mjs`

The "clean BrowserService" extract shipped with the A1 phase was dead code: it
passed `node --check` but referenced identifiers that were never defined
(`env2`, `import_chrome_remote_interface`, `killProcessTree`,
`CHROME_TMPDIR_PREFIX`) and nothing imported it at runtime — every method call
would ReferenceError (design review 2026-08-12 §6.3). It was deleted in 3.82.0;
recover it from git history if ever needed. The full CDP/Chrome path is the
managed headless Chrome (`src/computer/chrome-session.mjs` + `src/computer/modules/browser-cdp.mjs`), bridged by the single bundle engine since ADR 0006.

## Lineage

The retired vendored bundle is archived on GitHub release `computer-bundle` (ADR 0005).

## How to verify

```bash
node --test test/native-tools-registry.test.mjs test/computer-engine.test.mjs
```
