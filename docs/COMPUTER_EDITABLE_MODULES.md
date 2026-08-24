# Computer editable modules (the A1 "win")

## Goal

Treat **XClaw computer server** as the source — but **edit clean modules**, not the 16.8MB blob by hand.

## Current state (post-Strategy C)

The maintained tool modules live in `src/computer/modules/` (bash, file read/write/edit, browser_tab, registry) and are composed by:

- `src/computer/thin-server.mjs` — the default **native** engine
- `src/computer/generated/computer-server.mjs` — the esbuild **generated** engine (`npm run build:computer`)

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
managed headless Chrome (`src/computer/chrome-session.mjs` + `src/computer/modules/browser-cdp.mjs`) — single native engine since ADR 0005.

## Lineage

The retired vendored bundle is archived on GitHub release `computer-bundle` (ADR 0005).

## How to verify

```bash
npm run build:computer     # modules → generated/computer-server.mjs
node --test test/computer-strategy-c.test.mjs test/computer-c3-generated.test.mjs
```
