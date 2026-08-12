# XClaw project notes

- Self-hosted **agent gateway + computer** monorepo (Node.js **ESM**).
- Tools use the `xclaw_*` prefix (`xclaw_bash`, `xclaw_file_read`, …).
- **Computer Strategy C:** edit `src/computer/modules/**`; do **not** hand-edit `xclaw-server.mjs` (~16MB runtime).
- Build: `npm run build:computer` → `src/computer/generated/computer-server.mjs`.
- Profiles: `lab` / `dev` / `prod` via `XCLAW_PROFILE`.
- Do not commit secrets, API keys, or PATs.
- Public repo: https://github.com/Matrixx0070/xclaw
