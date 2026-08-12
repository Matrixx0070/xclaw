# XClaw ↔ OpenClaw parity matrix

Honest status as of Phase 7. Not a claim of full OpenClaw compatibility.

| # | Feature | XClaw status | Notes |
|---|---------|--------------|--------|
| 1 | Subagents / spawn | **Partial** | `xclaw_spawn_subagent` + HTTP spawn path |
| 2 | Tool-loop detection | **Done** | OpenClaw-ported detectors + simple detector |
| 3 | Channel allowlists | **Done** | Telegram/Discord allow lists in config |
| 4 | MCP bridge | **Partial** | List/call paths; not full MCP product surface |
| 5 | Session routing | **Partial** | Session keys / router present |
| 6 | Exec approvals | **Done** | Approval gate wired into tool path |
| 7 | Multi-provider routes | **Done** | Prefix routes (openai/xai/anthropic) |
| 8 | Cron + hooks | **Partial** | Jobs + doctor schedule; not full OpenClaw cron UX |
| 9 | Daemon helpers | **Partial** | systemd unit helpers / CLI daemon |
| 10 | Canvas / media | **Stub** | `/media/*` stubs only |

## Additional XClaw capabilities

| Feature | Status |
|---------|--------|
| Skills + memory injection | Done |
| Control UI | Done |
| Token usage / cache / eviction | Done (advanced) |
| Transport retry + jitter + Retry-After | Done (Phase 7) |
| Doctor CLI | Done (Phase 7) |
| Config validation | Done (Phase 7) |

## Legend

- **Done** — usable in normal operation  
- **Partial** — works for core path; missing OpenClaw breadth  
- **Stub** — endpoint or shell only; not production-complete  

When evaluating “full OpenClaw,” use this matrix—not marketing language.
