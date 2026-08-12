# Browser unbundle policy (Strategy C)

## Goal
Do **not** hand-edit `src/computer/xclaw-server.mjs` (~16MB). Browser capability grows via **modules**.

## Paths

| Engine | Entry | Browser capability |
|--------|--------|-------------------|
| **native** (default) | `thin-server.mjs` + `modules/browser-tab-tool.mjs` | Lightweight fetch/tab registry; no full CDP |
| **generated** | `generated/computer-server.mjs` | esbuild from modules (`npm run build:computer`) |
| **bundle** | `xclaw-server.mjs` | Full CDP / BrowserService — runtime artifact only |

## Rules
1. New browser behavior → `src/computer/modules/**` or `src/browser/**`
2. Rebuild generated with `npm run build:computer`
3. Bundle is **opt-in** (`XCLAW_COMPUTER_ENGINE=bundle`) for full CDP
4. Philosophy filter: one default story (native/generated), not three products

## Status
- Extracted tool: `modules/browser-tab-tool.extracted.mjs` / `.mjs`
- Full CDP remains in bundle until parity matrix is green (C4)
