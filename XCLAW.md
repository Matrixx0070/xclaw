# XClaw project notes

> **Auto-injected** into the agent system prompt when `memory.enabled` is not `false` (default on).
> Inspect with: `node bin/xclaw.mjs memory show`

- Self-hosted **agent gateway + computer** monorepo (Node.js **ESM**).
- Tools use the `xclaw_*` prefix (`xclaw_bash`, `xclaw_file_read`, …).
- **Computer Strategy C:** edit `src/computer/modules/**`; do **not** hand-edit `xclaw-server.mjs` (~16MB runtime).
- Build: `npm run build:computer` → `src/computer/generated/computer-server.mjs`.
- Profiles: `lab` / `dev` / `prod` via `XCLAW_PROFILE`.
- Do not commit secrets, API keys, or PATs.
- Public repo: https://github.com/Matrixx0070/xclaw

## Commands

- Agent one-shot: `node bin/xclaw.mjs agent "goal"`
- Project memory preview: `node bin/xclaw.mjs memory show`
- Computer build: `npm run build:computer`
- Tests (memory): `node --test test/project-memory-inject.test.mjs`

## Security (privacy + killable)

- **Egress:** prod profile defaults to **deny** network shell (`curl`/`wget`/`ssh`/URLs).  
  - Override: `XCLAW_EGRESS=allow|deny|allowlist`  
  - Allowlist: `security.egress.allowHosts: ["api.x.ai"]` in config  
- **Sandbox:** tool paths stay under workspace unless `sandbox.allowPaths`  
- **Kill-switch:**  
  - `node bin/xclaw.mjs stop-all` — abort active agent sessions + stop computer  
  - `node bin/xclaw.mjs sessions-active` — list live sessions  
  - Every `runAgentLoop` registers a session and respects abort  
- **Auth:** prod should set `requireAuth` + `XCLAW_GATEWAY_TOKEN`  
- Never commit API keys; rotate any key pasted into chat

## Transcripts

- `node bin/xclaw.mjs transcripts list`  
- `node bin/xclaw.mjs transcripts show <sessionId>`

## OS sandbox (bubblewrap)

- `security.osSandbox`: `off` | `auto` | `bwrap` (default `auto` — use bwrap when installed)
- Env: `XCLAW_OS_SANDBOX`, `XCLAW_BWRAP`, `XCLAW_OS_SANDBOX_NET=deny|allow`
- When active, bash runs under `bwrap` (workspace RW, system RO, optional `--unshare-net` if egress deny)
- Install: `apt install bubblewrap` (Linux)
