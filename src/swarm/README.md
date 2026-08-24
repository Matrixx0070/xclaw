# src/swarm — the unified swarm subsystem (ADR 0004)

One subsystem, two complementary strategies, zero external dependencies:

- **Ensemble** (`src/agents/swarm-*.mjs` · `POST /swarm/run`,
  `/swarm/run/stream`, `/swarm/merges`): N parallel attempts on ONE task,
  ballots/quorum/merge. Redundancy against a hard problem.
- **Decompose** (`src/swarm/decompose/` · `POST /swarm/goals`,
  `GET /swarm/tasks/:id`, `POST /swarm/tasks/:id/cancel`,
  `GET /swarm/decompose/health|stats|sessions`): LLM goal decomposition →
  DAG with cycle-breaking → parallel sub-agents on xclaw's REAL tool
  router → merge policy → execution receipt. Division of labor across
  DIFFERENT subtasks. Legacy `/api/swarm/*` aliases still answer.

## Decompose engine layout

- `runtime.mjs` — builds llm adapter + tool registries + per-session
  orchestrators once; plain async functions for the gateway route
  (`src/gateway/routes/swarm-goals.mjs`). No express.
- `decompose/` — orchestrator, dag-engine, execution groups, sub-agent,
  merge policies, receipt, in-process task-queue + memory-store (redis
  replaced behind identical interfaces).
- `tool-bridge.mjs` — exposes the real tool planes (xclaw_bash/file_*,
  glob/grep, web_search/web_fetch, generate_image) to sub-agents,
  FAIL-CLOSED risk-gated (`swarm.decompose.tools.autoApproveMaxTier`,
  default `low`; sub-agents can never pend for approval). Optional
  operator egress policy via `swarm.decompose.tools.policy`
  (tool blocklist/allowlist, egress deny, URL host allowlist —
  SSRF-safe suffix matching).
- `llm-adapter.mjs` — maps xclaw's provider interface onto the engine's
  `chat`/`structuredOutput` contract (fence-stripping JSON + retry).
- `plugins/` — REAL data/media plugins (yahoo_finance, sec_edgar,
  world_bank, imf, scholar, audio_generation via local TTS) plus the
  remaining vendor utilities; `plugins-lib/http.mjs` is the shared
  keyless HTTP helper. Remaining vendor stubs
  (web-search/web-extract/code-executor/browser) are shadowed by real
  bridge tools at merge time.

## Config

```jsonc
{
  "swarm": {
    "decompose": {
      "enabled": false,          // master switch (OFF by default)
      "model": null,              // defaults to cfg.agent.model
      "maxSubAgents": 25,
      "maxConcurrent": 8,
      "tools": {
        "enabled": true,
        "autoApproveMaxTier": "low",
        "allow": null,            // null = curated DEFAULT_ALLOW
        "alwaysAllow": null,      // default: web_search/web_fetch
        "policy": null            // optional ToolPolicy egress config
      }
    }
  }
}
```

Legacy `swarmExt.*` keys are still honored (deprecated alias).
Engine tuning (timeouts, merge policy, budget, watchdog) lives in
`decompose-config.json`, loaded from this directory — never from cwd.

## History

Landed 2026-08-24 from an operator-delivered extension zip as the isolated
`src/swarm-ext` module (ADR 0003), fixed (8 vendor defects), wired to real
tools, then unified into core with the express/ioredis/zod dependencies
removed (ADR 0004). `git log --follow` on any decompose file crosses the
move.
