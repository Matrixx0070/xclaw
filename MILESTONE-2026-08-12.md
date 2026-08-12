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

## Git

- Local commits include loop-guard presets + swarm merge work
- Remote: https://github.com/Matrixx0070/xclaw (partial MCP push; full push needs PAT)

## How to run

```bash
export XAI_API_KEY=...
export XCLAW_PROFILE=lab
node bin/xclaw.mjs agent "your goal"
# swarm (programmatic): runSwarmFanOut with role implement/verify
```

## Known gaps

- Full GitHub push from sandbox (no credentials)
- True 3-way merge (P2) not implemented
- Soak/eval not continuous CI yet
- Bundle (16MB) vs thin computer parity not re-proven this session

## Next after this freeze

1. `git push origin main` with PAT
2. CI job: `node --test test/merge-*.test.mjs test/swarm-early-merge.test.mjs`
3. Optional P2 branch merge
