# MCP / tool surface parity (checklist)

XClaw exposes tools via the **agent loop** (local registry + computer server) and a **lightweight MCP HTTP/stdio** server. This is an honest inventory vs typical OpenClaw-class surfaces — not a claim of 1:1 feature parity.

## Local agent tools (registry)

| Area | XClaw tools | Notes |
|------|-------------|-------|
| Web | `web_search`, `web_fetch` | |
| Files / host | `glob`, `grep`, `file_type`, `host_capabilities`, `markitdown`, `office_convert`, `ocr` | Computer server also has bash/files |
| Browser | `browser_observe`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_clipboard`, `browser_pdf`, `browser_assert` | Structure-first + hybrid pixels |
| Fabric | `tab_lease`, `commit_gate`, `fabric_status`, `session_role` | Multi-agent browser safety |
| MITM | `mitm_*` | Optional traffic truth channel |
| Media | `view_image`, `edit_image`, `generate_image`, `search_images`, `view_x_video` | |
| X / social | `x_keyword_search`, `x_semantic_search`, `x_thread_fetch`, `x_user_search` | |
| Finance | `finance_quote` | |
| Connected | `search_connected_tool`, `call_connected_tool` | GitHub / voice / automations when linked |
| Trace | `trace_replay`, `trace_score` | |

Computer plane (separate): bash, file read/write, browser_tab/CDP, etc. via `xclaw_*` on the computer server.

## MCP server (`src/mcp/`)

Built-ins include conversation list/get and tool bridging (see `createXclawBuiltinMcpTools`). Stdio entry: `xclaw mcp`.

| Capability | Status |
|------------|--------|
| List sessions / get conversation | Present |
| Bridge local tools over MCP | Partial — handlers in `handlers.mjs` |
| Channel send (Telegram/Discord) as MCP tools | Prefer gateway channels, not full MCP mirror |
| Skill install over MCP | **Intentionally not** in prod without owner gate |

## Gaps vs “full OpenClaw-class”

1. Not every channel action is dual-exposed as MCP + gateway REST.
2. Computer tools are session-scoped (need live computer), not pure MCP-stateless.
3. Gmail/Calendar/Slack *servers* as standalone FastAPI clones are out of scope; use connected tools / channel config instead.
4. Skill writeback is proposal-first; prod install is owner-gated (see `docs/AUTONOMY.md`).

## How to extend

1. Add tool in `src/tools/*.mjs` → register in `registry.mjs`.
2. Optionally expose via `src/mcp/handlers.mjs`.
3. Add a unit test under `test/` and, if long-horizon, a fixture under `test/long-horizon-fixtures.test.mjs`.
