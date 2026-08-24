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

`plugins/{web-search,web-extract,tts,code-executor,browser}` contain
"in production, integrate..." stubs; `src/swarm/computer/screen.mjs`
OCR is a stub. `calculator`, `file-reader`, `web-crawl` and the core
orchestration pipeline are real. The bridge shadows the important ones with
real tools (web_search/web_fetch, xclaw_bash beats code_execute), and the
`image-generate` stub was REMOVED in 3.167.0 — the real `generate_image`
(xAI images API via the credential store) is exposed through the bridge.

## Real data plugins (3.167.0 — replace the stub drop from the
"complete-final" zip, which fabricated data)

`plugins/{yahoo-finance,sec-edgar,world-bank,imf,scholar}` are REAL keyless
API clients (Yahoo chart API; SEC data.sec.gov submissions+XBRL facts; World
Bank Open Data v2; IMF DataMapper; Semantic Scholar with OpenAlex fallback).
Shared HTTP in `plugins-lib/http.mjs` (URL-free UA — SEC's WAF 403s UAs
containing URLs; single 429/503 retry honoring Retry-After). Each constructor
takes `{ fetchImpl }` so tests inject fakes — CI never touches the network.
The zip's `audio-generation` stub was NOT landed: xclaw has no real TTS
backend to route it to, and a tool returning fabricated audio URLs is worse
than no tool. SCAFFOLD note: `sec-edgar` carries a built-in top-50 ticker→CIK
fallback because www.sec.gov (the index file host) is IP-blocked from some
datacenters, while data.sec.gov (the actual data) is not.

## Tests

- Vendor tests: `npm test --prefix src/swarm-ext` (needs deps installed).
- Integration-glue tests run in the main suite without extension deps.

## Security posture (review 2026-08-24)

- The ENTIRE `/api/swarm` surface requires the gateway operator token in both
  auth modes — it is a single-operator API. `GET /tasks/:id` intentionally has
  no per-session ACL beyond that token (all sessions belong to the operator).
- Task/agent ids come from `crypto.randomUUID()` (utils.mjs) — not guessable.
- `tool-policy.mjs` URL allowlist uses exact-host or dot-suffix matching
  (the vendored substring `hostname.includes()` was a bypass — fixed). Note
  ToolPolicy is exported but not yet wired into the sub-agent execute path.
- `swarm-ws.mjs` is NOT mounted; see the warning header in that file before
  ever wiring it.
