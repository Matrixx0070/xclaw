# swarm-ext — isolated opt-in swarm extension (vendored)

Vendored from `xclaw-swarm-extension-xclaw-branded.zip` (received 2026-08-24 via
Tailscale, 104 files). This is a SECOND, independent multi-agent orchestration
engine that coexists with — and does not replace — xclaw's native swarm
(`src/agents/swarm-*.mjs`, `/swarm/*` routes). See `docs/adr/0003-swarm-ext-isolated-module.md`;
ADR 0002's never-drop-capabilities rule is preserved: the native swarm is untouched.

## Status

- **OFF by default.** The gateway only imports this subtree when
  `swarmExt.enabled: true` is set in xclaw config. With the flag off, xclaw
  behaves exactly as before (`/api/swarm/*` answers 404).
- **Zero-dep core preserved.** The root `package.json` still declares no
  dependencies. This module's deps (`express`, `ioredis`, `zod`) install ONLY
  here: `npm install --prefix src/swarm-ext` (node_modules is gitignored).
  If deps are missing while enabled, `/api/swarm/*` answers 503 with a hint.
- Requires a reachable Redis (`redis://localhost:6379` by default —
  task queue, pub/sub progress, session/memory stores).

## What it does

`POST /api/swarm/goals {goal, sessionId?, profile?, constraints?}` →
LLM goal decomposition → DAG with cycle-breaking → parallel sub-agent pool →
merge policy (llm / vote / quorum / concat) → execution receipt → PARL reward
sample. Plus `GET /tasks/:id`, `POST /tasks/:id/cancel`, `GET /health|stats|sessions`,
`POST /batch`, `GET /receipts/:taskId`. All routes require the operator token
(gateway auth protects `/api/swarm` in both legacy and strict modes).

## Local integration glue (not vendor code)

- `llm-adapter.mjs` — maps the vendor `llm.chat(messages,{tools})` /
  `llm.structuredOutput(messages,schema)` interface onto xclaw's
  `createProvider` + provider routing. Dependency-free, unit-tested in the
  main suite (`test/swarm-ext.test.mjs`).
- `mount.mjs` — builds the express app once (config pinned to this subtree,
  telemetry server force-disabled, models routed through xclaw's configured
  provider), and serves gateway-delegated requests.

## Config

Tuning lives in `src/swarm-ext/xclaw-swarm.json` (loaded from the subtree,
never from cwd). xclaw-side keys under `swarmExt`:

```jsonc
{
  "swarmExt": {
    "enabled": false,        // master switch (default false)
    "model": null,            // optional override; defaults to cfg.agent.model
    "maxSubAgents": 25,       // caps vendor default of 300
    "maxConcurrent": 8
  }
}
```

## Deviations from the delivered zip (each deliberate)

1. `import { fetch } from "node-fetch"` removed from the 5 plugin tools —
   node-fetch v3 has no named `fetch` export (would be `undefined` at runtime);
   Node ≥ 22's global fetch is used instead. Drops the dependency entirely.
2. `package.swarm.json` declared 11 dependencies; only `express`, `ioredis`,
   `zod`, `node-fetch` are actually imported anywhere. This module's
   `package.json` declares the real three (node-fetch removed per #1).
   bullmq / dockerode / playwright / piscina / tiktoken / uuid / ws were never
   imported by any shipped file.
3. Vendor `xclaw-swarm.json` tuned: `maxSubAgents 300→25`, `maxConcurrent
   300→8`, `telemetry.enabled→false` (metrics server would bind :9090),
   `sandbox.enabled→false` (honesty: the shipped `BashTool` spawns plain
   `bash -c` on the host; the docker sandbox config is aspirational — the
   `docker/` images are included but nothing in the code path uses them yet).
4. WebSocket progress route (`setupSwarmWebSocket`) is NOT wired — it expects
   its own ws server; xclaw's WS plane is separate. REST polling
   (`GET /tasks/:id`) covers progress. Documented gap, not a silent drop.

## Known vendor stubs (shipped as delivered)

`plugins/{web-search,web-extract,tts,code-executor,browser,image-generate}`
contain "in production, integrate..." stubs; `src/swarm/computer/screen.mjs`
OCR is a stub. `calculator`, `file-reader`, `web-crawl` and the core
orchestration pipeline are real.

## Tests

- Vendor tests: `npm test --prefix src/swarm-ext` (needs deps installed).
- Integration-glue tests run in the main suite without extension deps.
