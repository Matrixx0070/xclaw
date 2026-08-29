# XClaw project notes

> **Auto-injected** into the agent system prompt when `memory.enabled` is not `false` (default on).  
> Inspect: `node bin/xclaw.mjs memory show`  
> Human entry path: **[README.md](./README.md)**

## Core

- Self-hosted **agent gateway + computer** (Node.js **ESM**).
- Tools use the `xclaw_*` prefix (`xclaw_bash`, `xclaw_file_read`, …).
- **Strategy C:** edit `src/computer/modules/**`; do **not** hand-edit `xclaw-server.mjs` (~16MB runtime).
- Build: `npm run build:computer` → `src/computer/generated/computer-server.mjs`.
- The 16MB CDP bundle is an **opt-in release artifact** (not in git): `npm run fetch:bundle` (sha256-pinned in `src/computer/bundle-artifact.json`). Only `XCLAW_COMPUTER_ENGINE=bundle` needs it; native/generated don't.
- Profiles: `lab` / `dev` / `prod` via `XCLAW_PROFILE`.

## Security (keep these true)

- **Secrets:** never commit API keys, OAuth tokens, or PATs; rotate if exposed.
- **Egress:** prod defaults toward **deny** for network-capable shell; override with `XCLAW_EGRESS`.
- **Spawn:** approved bash runs the **frozen** command (`-c`, not login `-lc`) when a plan is bound.
- **OS sandbox:** `XCLAW_OS_SANDBOX=auto|bwrap|off` — bubblewrap when installed **and** usable (some CI hosts block uid maps).
- **Kill:** `node bin/xclaw.mjs stop-all` · `sessions-active`.
- **Resume:** gateway boot auto-resumes unfinished agent-run snapshots as objectives (kill/approval/budget stay put). `agent.autoResume:false` to opt out.
- **Prod:** set `XCLAW_GATEWAY_TOKEN`; do not run exposed gateway with lab auto-approve.

## MCP (agent-loop native)

- `mcp.servers` in config → tools join **every** `runAgentLoop` as `mcp__<server>__<tool>`, dispatched through the same sandbox/egress/approval path as built-ins.
- Server shapes: `{ "name": "gh", "command": "npx", "args": ["-y","@modelcontextprotocol/server-github"], "env": {...} }` (stdio) or `{ "name": "web", "url": "http://127.0.0.1:8931/mcp", "apiKey": "..." }` (HTTP JSON-RPC).
- Discovery is fail-open per server (bad server = event + no tools, run continues); `tools/list` cached (`mcp.listTtlMs`, default 5m); stdio children killed at loop end.
- Inspect: `GET /mcp/status`, `GET /mcp/tools?refresh=1`, `xclaw doctor` (`mcp` check).
- Knobs: `mcp.enabled=false` kill-switch · `mcp.listTimeoutMs` (8s) · `mcp.requestTimeoutMs` (30s).

## Commands

- One-shot: `node bin/xclaw.mjs agent "goal"` (persists under `--session`; a turn-cap cutoff continues as a durable `/objective`)
- Doctor: `node bin/xclaw.mjs doctor`
- Memory preview: `node bin/xclaw.mjs memory show`
- Computer build: `npm run build:computer`
- Tests (examples): `node --test test/spawn-enforce.test.mjs test/os-sandbox.test.mjs`

## Repo

- Public/source: https://github.com/Matrixx0070/xclaw
