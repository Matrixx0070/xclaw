# XClaw project notes

> **Auto-injected** into the agent system prompt when `memory.enabled` is not `false` (default on).  
> Inspect: `node bin/xclaw.mjs memory show`  
> Human entry path: **[README.md](./README.md)**

## Core

- Self-hosted **agent gateway + computer** (Node.js **ESM**).
- Tools use the `xclaw_*` prefix (`xclaw_bash`, `xclaw_file_read`, …).
- **Strategy C:** edit `src/computer/modules/**`; do **not** hand-edit `xclaw-server.mjs` (~16MB runtime).
- Build: `npm run build:computer` → `src/computer/generated/computer-server.mjs`.
- Profiles: `lab` / `dev` / `prod` via `XCLAW_PROFILE`.

## Security (keep these true)

- **Secrets:** never commit API keys, OAuth tokens, or PATs; rotate if exposed.
- **Egress:** prod defaults toward **deny** for network-capable shell; override with `XCLAW_EGRESS`.
- **Spawn:** approved bash runs the **frozen** command (`-c`, not login `-lc`) when a plan is bound.
- **OS sandbox:** `XCLAW_OS_SANDBOX=auto|bwrap|off` — bubblewrap when installed **and** usable (some CI hosts block uid maps).
- **Kill:** `node bin/xclaw.mjs stop-all` · `sessions-active`.
- **Prod:** set `XCLAW_GATEWAY_TOKEN`; do not run exposed gateway with lab auto-approve.

## Commands

- One-shot: `node bin/xclaw.mjs agent "goal"`
- Doctor: `node bin/xclaw.mjs doctor`
- Memory preview: `node bin/xclaw.mjs memory show`
- Computer build: `npm run build:computer`
- Tests (examples): `node --test test/spawn-enforce.test.mjs test/os-sandbox.test.mjs`

## Repo

- Public/source: https://github.com/Matrixx0070/xclaw
