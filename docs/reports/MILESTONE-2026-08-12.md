# XClaw Milestone — 2026-08-12

## Claim (accurate)

Self-hosted multi-LLM agent OS with computer tools, swarm DAG, receipts, and production-minded guards. **Competitive with serious OSS peers; not past every closed lab product.**

## Proven this session

| Capability | Evidence |
|------------|----------|
| Live agent + tools (xAI) | Multi-step coding, bugfix, file tools |
| Loop guards | Lab global breaker **60**, prod **25**; env overrides |
| Unit suite | **895/895** (pre–late patches); merge/guard tests added |
| Swarm DAG | implement → verify live |
| Early merge (A) | Worktree untracked → main **before** verify → **PASS** |
| Merge P0 | Implement-only candidates; same-tree noop |
| Merge P1 | `PATCH_CORRUPT`, `PATCH_REJECT`, `UNSAFE_PATH`, `COPY_*` codes |
| Strategy C1–C3 | Modules source; esbuild generated server; 16MB CDP retained |

## Git

- Remote: https://github.com/Matrixx0070/xclaw
- Strategy C files pushed via GitHub MCP from sandbox

## How to run

```bash
export XAI_API_KEY=...
export XCLAW_PROFILE=lab
node bin/xclaw.mjs agent "your goal"
npm run build:computer
XCLAW_COMPUTER_ENGINE=generated  # modules-built
```

## Soak (this freeze)

- Script: scripts/soak-agent.mjs
- Result: 3/3 pass (passRate 1.0)
