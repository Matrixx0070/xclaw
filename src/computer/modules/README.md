# Computer modules — full bundle map (~16.8 MB)

The runtime entry remains `../xclaw-server.mjs` (Grok-lineage bundle).

This directory holds **extracted application regions** so we can edit and reason
about the full computer server without treating 16.8MB as one opaque file.

## Layout

| File | Origin in bundle | Role |
|------|------------------|------|
| `../browser-service.mjs` | L~382706–383270 | **Clean importable** Chrome/CDP service |
| `bash-tool.extracted.mjs` | xclaw_bash | Shell tool |
| `browser-tab-tool.extracted.mjs` | xclaw_browser_tab | Navigate / JS / screenshot |
| `browser-network-details-tool.extracted.mjs` | network details | |
| `file-*-tool.extracted.mjs` | file edit/read/write | |
| `skills-context.extracted.mjs` | skills + context | |
| `http-server-main.extracted.mjs` | routes + main() | HTTP/stdio server |
| `../MODULE_MAP.json` | whole file | Line regions for all ~395k lines |

## What “full 16.8MB” means

- **~380k lines** — vendored deps + CDP protocol types (not hand-edited)
- **~15k lines** — application (tools, BrowserService, routes) — **extracted / mapped**
- **Clean module** — `browser-service.mjs` is the first fully rewired, importable unit

Winning path: grow clean modules → wire entry to import them → shrink reliance on string-patching the blob.

See `../../docs/COMPUTER_EDITABLE_MODULES.md` and `../../docs/COMPUTER_SOURCE_OF_TRUTH.md`.
