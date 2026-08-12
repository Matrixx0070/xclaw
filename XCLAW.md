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
