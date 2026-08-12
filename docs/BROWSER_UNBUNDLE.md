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

## The bundle is a release artifact, NOT tracked in git
The 16MB `xclaw-server.mjs` was 64% of the repo. It now lives in the
`computer-bundle` GitHub release and is **git-ignored**. Integrity is pinned by
sha256 in `src/computer/bundle-artifact.json`.

- Install it: `npm run fetch:bundle` (verifies sha256; prefers `gh release download`, falls back to the direct URL).
- Auto-fetch: starting with `engine=bundle` and no local copy triggers a fetch (disable with `XCLAW_BUNDLE_AUTOFETCH=0`).
- Updating the bundle: `npm run publish:bundle [path]` does it atomically — uploads the asset, re-downloads to verify the checksum round-trips, then rewrites `bytes`/`sha256` in `bundle-artifact.json` (manifest is left untouched if the upload/verify fails). `--dry-run` previews. Commit the manifest afterward.
- The default `native`/`generated` engines never need it.

## Status
- Extracted tool: `modules/browser-tab-tool.extracted.mjs` / `.mjs`
- Full CDP remains in the release bundle until the parity matrix is green (C4)
