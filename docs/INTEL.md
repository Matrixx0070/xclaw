# Persistent Repo Intelligence

A per-repo incremental index (`~/.xclaw/intel/<repo-key>/`) so agents stop
rediscovering the same repository every run. Deliberately not vector-RAG: the
index stores cheap deterministic facts (regex symbols, relative-import edges,
git churn, tests-map); the model does the understanding.

## Keying

`sha256(git common dir)` — mission **worktrees share the main repo's index**,
so what one mission learns, the next one starts with. Non-git dirs key by
resolved path.

## Store contents

- `index.json` — per-file `{mtimeMs, size, kind, symbols, imports}` +
  `importedBy` in-degree + git-heat + tests-map (test file → sources it
  imports). Incremental: stat-diff re-extracts only changed files; git-heat
  refreshes on HEAD change; >30% churn in repos >50 files triggers a rebuild;
  corruption rebuilds silently. Warm refresh on the xclaw repo itself: ~60ms.
- `notes.jsonl` — deterministic facts appended by completed missions (goal,
  merged files, verify commands that passed).
- `brief.md` — the compounding extractive brief: central modules, hot files,
  proven verify commands, recent missions. Prepended to mission plan context.

## Consumers

- Mission plan phase (`missions/engine.mjs`) — warm ranked context + brief;
  falls back to the legacy per-call scan if the store fails.
- Every agent run — the `xclaw_repo_intel` tool
  (`{action: brief|context|symbols|search, query}`), registered unless
  `cfg.intel.tool === false`. Missions include it in `DEFAULT_MISSION_TOOLS`.

## Not built (by design)

Embeddings/vector DB, per-language AST parsers, per-file LLM summaries.
`eval/cases/intel.json` guards the tool's usefulness.
