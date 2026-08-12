# S2 — Task graph (dependsOn)

## Overview

`xclaw_swarm_run` accepts a **DAG** of tasks:

```json
{
  "goal": "Add health endpoint and prove it",
  "tasks": [
    { "id": "impl", "task": "Add GET /health", "role": "implement" },
    {
      "id": "verify",
      "task": "curl /health and report",
      "role": "verify",
      "dependsOn": ["impl"]
    },
    {
      "id": "critic",
      "task": "Review risks",
      "role": "critic",
      "dependsOn": ["verify"]
    }
  ],
  "onDepFail": "skip-downstream"
}
```

Flat string tasks still work (S1): auto ids `t0`, `t1`, … with no edges.

## Scheduling

1. `normalizeTaskGraph` — ids, validate deps, reject cycles  
2. `topologicalWaves` — levels that can run in parallel  
3. Each wave runs with concurrency ≤ `swarm.maxParallel`  
4. Downstream prompts include **upstream result text** (truncated)  
5. Join summary includes **ASCII wave diagram**

## Failure policy (`onDepFail`)

| Value | Behavior |
|-------|----------|
| `skip-downstream` (default) | Failed/timeout dep → dependents **skipped** |
| `fail-fast` | First real failure skips all remaining pending |
| `best-effort` | Downstream still runs (sees failed upstream in context) |

## Persist

`SwarmRun` under `~/.xclaw/swarms/runs/` stores:

- `graph[]` with status / childId  
- `ascii`, `mermaid`, `dot`  
- `summary` with wave diagram  

## Caps

Same as S1: `maxParallel` (≤5), `maxChildrenPerRun` (≤8), `subagentTimeoutMs`.

## Error handling

Pre-flight and tool errors return structured objects:

```json
{
  "ok": false,
  "code": "UNKNOWN_DEP",
  "error": "unknown dependsOn: missing (from a)",
  "retryable": false,
  "details": {
    "nodeId": "a",
    "dependsOn": "missing",
    "hint": "dependsOn must reference ids that exist in the same tasks list."
  }
}
```

| Code | Meaning | Retryable |
|------|---------|-----------|
| `SWARM_DISABLED` | `swarm.enabled: false` | No |
| `TASKS_REQUIRED` | Empty tasks | No |
| `MISSING_ID` / `MISSING_TASK` | Bad node shape | No |
| `DUPLICATE_ID` | Repeated id | No |
| `UNKNOWN_DEP` | dependsOn not in graph | No |
| `SELF_DEP` | Node depends on itself | No |
| `CYCLE` | Cyclic graph | No |
| `TOO_MANY_TASKS` | Over maxChildrenPerRun | No |
| `INVALID_POLICY` | Bad onDepFail | No |
| `PERSIST_FAILED` | Disk write failed | Yes |
| `SPAWN_FAILED` | Child start/crash | Yes |
| `TIMEOUT` | Child hit timeout | Soft |
| `ABORTED` | Parent signal aborted | No |

Node results may include `code`. `persistGraph` failures are logged and do not abort an in-flight wave.

## Retry logic (node-level)

Transient child failures are retried before the node is marked failed.

| Setting | Default | Meaning |
|---------|---------|---------|
| `swarm.nodeRetries` | `2` | Extra attempts after the first (3 total) |
| `swarm.retryBaseMs` | `500` | Backoff base |
| `swarm.retryCapMs` | `15000` | Backoff cap |
| per-task `retries` | — | Override for one node |

**Retried codes:** `SPAWN_FAILED`, `TIMEOUT`, and errors matching `ECONNRESET` / `ETIMEDOUT` / `429` / `503` / …

**Not retried:** `ABORTED`, `skipped`, graph validation errors, successful nodes.

### Backoff strategies (`swarm.retryStrategy`)

| Strategy | Formula (then `min(cap, ·)`) |
|----------|------------------------------|
| **`decorrelated`** (default) | `rand(base, prev×3)` — spreads concurrent retries |
| **`exponential`** | `base × 2^(attempt-1)` — fixed schedule |
| **`full`** | `rand(0, exp)` — AWS full jitter |
| **`equal`** | `exp/2 + rand(0, exp/2)` |
| **`none`** | `0` — retry immediately |

`Retry-After: N` in the error string (seconds) raises the delay to at least N×1000 ms when `respectRetryAfter` is true (default), with optional ±`retryAfterJitterRatio`.

Events: `child_retry` with `attempt`, `delayMs`, `strategy`, `code`.

Final node result includes `attempts` (how many tries were used).

---

## Usage examples

### 1. Flat parallel research (S1 style)

Agent tool call — three independent researches, one join summary:

```json
{
  "goal": "Compare packaging options for a Node CLI",
  "tasks": [
    "Summarize pros/cons of npm package",
    "Summarize pros/cons of standalone binary (pkg/nexe)",
    "Summarize pros/cons of Docker-only distribution"
  ]
}
```

Auto ids: `t0`, `t1`, `t2` — all wave 0, up to `maxParallel` concurrent.

---

### 2. Linear pipeline (implement → verify → critic)

```json
{
  "goal": "Add GET /health that returns {\"ok\":true}",
  "tasks": [
    {
      "id": "impl",
      "role": "implement",
      "task": "Add GET /health returning JSON {\"ok\":true}. Smallest diff."
    },
    {
      "id": "verify",
      "role": "verify",
      "dependsOn": ["impl"],
      "task": "Start or curl the service and confirm /health returns ok."
    },
    {
      "id": "critic",
      "role": "critic",
      "dependsOn": ["verify"],
      "task": "List residual risks (auth, logging, tests)."
    }
  ],
  "onDepFail": "skip-downstream"
}
```

If `impl` fails after retries → `verify` and `critic` are **skipped**.

---

### 3. Diamond: parallel research → merge

```json
{
  "goal": "Pick a retry strategy for swarm nodes",
  "tasks": [
    { "id": "r1", "role": "research", "task": "When is full jitter best?" },
    { "id": "r2", "role": "research", "task": "When is decorrelated jitter best?" },
    {
      "id": "merge",
      "role": "research",
      "dependsOn": ["r1", "r2"],
      "task": "Recommend one default for XClaw swarm and why."
    }
  ]
}
```

```text
wave 0  [r1] [r2]     ← parallel
wave 1  [merge]       ← sees both upstream results in prompt
```

---

### 4. Config: retries + backoff strategy

In `~/.xclaw/xclaw.json` (or defaults):

```json
{
  "swarm": {
    "enabled": true,
    "maxParallel": 3,
    "maxChildrenPerRun": 8,
    "nodeRetries": 2,
    "retryStrategy": "decorrelated",
    "retryBaseMs": 500,
    "retryCapMs": 15000,
    "respectRetryAfter": true,
    "onDepFail": "skip-downstream"
  }
}
```

Stricter prod-style retries (predictable delays):

```json
{
  "swarm": {
    "retryStrategy": "exponential",
    "retryBaseMs": 1000,
    "retryCapMs": 30000,
    "nodeRetries": 3
  }
}
```

Per-task override (more attempts for flaky network work):

```json
{
  "id": "fetch",
  "role": "research",
  "task": "Fetch status from flaky API",
  "retries": 4
}
```

---

### 5. Fail-fast vs best-effort

**Fail-fast** — stop the rest of the graph after the first hard failure:

```json
{
  "goal": "Ship only if all checks pass",
  "onDepFail": "fail-fast",
  "tasks": [
    { "id": "unit", "role": "verify", "task": "Run unit tests" },
    { "id": "lint", "role": "verify", "task": "Run linter" },
    {
      "id": "ship",
      "role": "implement",
      "dependsOn": ["unit", "lint"],
      "task": "Tag release"
    }
  ]
}
```

**Best-effort** — still run downstream with failed upstream in context:

```json
{
  "onDepFail": "best-effort",
  "tasks": [
    { "id": "scan", "role": "research", "task": "Security scan (may fail)" },
    {
      "id": "report",
      "role": "research",
      "dependsOn": ["scan"],
      "task": "Write report; note scan gaps if scan failed"
    }
  ]
}
```

---

### 6. Programmatic (Node)

```js
import { runSwarmFanOut } from "../src/agents/swarm-run.mjs";
import { loadConfig } from "../src/config/load.mjs"; // adjust to your loader

const cfg = await loadConfig();
const out = await runSwarmFanOut(cfg, {
  goal: "Demo pipeline",
  tasks: [
    { id: "a", task: "Say hello", role: "research" },
    { id: "b", task: "Reply to upstream", role: "research", dependsOn: ["a"] },
  ],
  onDepFail: "skip-downstream",
});

console.log(out.status, out.swarmId);
console.log(out.ascii);
// out.summary — markdown join
// ~/.xclaw/swarms/runs/<id>.json — durable record
```

### 7. Graph viz only (no spawn)

```js
import {
  toAsciiWaves,
  toMermaid,
  toDot,
  examplePipelineGraph,
} from "../src/agents/graph-viz.mjs";

const g = examplePipelineGraph();
console.log(toAsciiWaves(g));
console.log(toMermaid(g));
console.log(toDot(g, { title: "demo" }));
// optional: dot -Tsvg demo.dot -o demo.svg
```

### 8. Chat / agent natural language

Owner to XClaw:

> Use a swarm: research auth options for our gateway in parallel (API key vs OAuth), then one task that depends on both and recommends a default for prod.

The parent agent should call `xclaw_swarm_run` with two `research` nodes and a third with `dependsOn: ["…","…"]`.

---

## Error handling examples

### E1. Empty tasks → `TASKS_REQUIRED`

```js
import { normalizeTaskGraph, runSwarmFanOut } from "../src/agents/swarm-run.mjs";

normalizeTaskGraph([]);
// {
//   nodes: [],
//   error: "tasks required",
//   code: "TASKS_REQUIRED",
//   details: { hint: "Pass a non-empty tasks array..." }
// }

const out = await runSwarmFanOut(cfg, { tasks: [] });
// out.ok === false
// out.code === "TASKS_REQUIRED"
// out.retryable === false
```

**Tool response** (`xclaw_swarm_run`):

```json
{
  "ok": false,
  "code": "TASKS_REQUIRED",
  "error": "tasks required",
  "retryable": false,
  "hint": "Pass a non-empty tasks array or newline-separated string."
}
```

---

### E2. Unknown dependency → `UNKNOWN_DEP`

```json
{
  "tasks": [
    { "id": "a", "task": "do work", "dependsOn": ["missing"] }
  ]
}
```

```json
{
  "ok": false,
  "code": "UNKNOWN_DEP",
  "error": "unknown dependsOn: missing (from a)",
  "retryable": false,
  "details": {
    "nodeId": "a",
    "dependsOn": "missing",
    "hint": "dependsOn must reference ids that exist in the same tasks list."
  }
}
```

**Fix:** add a node with `id: "missing"` or remove the edge.

---

### E3. Cycle → `CYCLE`

```json
{
  "tasks": [
    { "id": "a", "task": "A", "dependsOn": ["b"] },
    { "id": "b", "task": "B", "dependsOn": ["a"] }
  ]
}
```

```json
{
  "ok": false,
  "code": "CYCLE",
  "error": "cycle detected in task graph",
  "retryable": false
}
```

**Fix:** break the loop (A→B only, or introduce C).

---

### E4. Duplicate id → `DUPLICATE_ID`

```json
{
  "tasks": [
    { "id": "x", "task": "one" },
    { "id": "x", "task": "two" }
  ]
}
```

```json
{
  "ok": false,
  "code": "DUPLICATE_ID",
  "error": "duplicate node id in task graph",
  "details": { "duplicates": ["x"] }
}
```

---

### E5. Too many tasks → `TOO_MANY_TASKS`

```js
const tasks = Array.from({ length: 20 }, (_, i) => ({
  id: `t${i}`,
  task: `job ${i}`,
}));
const out = await runSwarmFanOut(cfg, { tasks });
// code: "TOO_MANY_TASKS"
// details: { count: 20, maxChildrenPerRun: 8 }
```

**Fix:** split into multiple swarm runs or raise `swarm.maxChildrenPerRun` (hard max 8 in current build).

---

### E6. Swarm disabled → `SWARM_DISABLED`

```js
await runSwarmFanOut({ swarm: { enabled: false } }, { tasks: ["hi"] });
// { ok: false, code: "SWARM_DISABLED", retryable: false }
```

---

### E7. Handling tool errors in the parent agent

```js
const toolResult = await swarmTool.execute({ goal, tasks });
// toolResult.isError === true on pre-flight failure

const body = JSON.parse(toolResult.content[0].text);
if (!body.ok && body.code) {
  // Do not retry graph shape errors
  if (["CYCLE", "UNKNOWN_DEP", "DUPLICATE_ID", "TASKS_REQUIRED"].includes(body.code)) {
    return `Swarm config error (${body.code}): ${body.error}. ${body.hint || body.details?.hint || ""}`;
  }
  // Transient
  if (body.retryable) {
    return `Swarm failed transiently (${body.code}); safe to retry later.`;
  }
}
```

---

### E8. Node-level failure + skip-downstream

Graph:

```text
impl (SPAWN_FAILED after retries) → verify → critic
```

Runtime outcome:

| Node | Status | Notes |
|------|--------|--------|
| `impl` | `error` | `code: SPAWN_FAILED`, `attempts: 3` |
| `verify` | `skipped` | upstream failed |
| `critic` | `skipped` | upstream failed |

Join summary status: **`partial`** or **`error`** if nothing succeeded.

`child_retry` events (example):

```json
{
  "type": "swarm",
  "phase": "child_retry",
  "nodeId": "impl",
  "attempt": 1,
  "nextAttempt": 2,
  "delayMs": 812,
  "strategy": "decorrelated",
  "code": "SPAWN_FAILED"
}
```

---

### E9. Programmatic check after a run

```js
const out = await runSwarmFanOut(cfg, { goal, tasks });

if (!out.ok && out.code) {
  // Pre-flight — no swarm id
  console.error(out.code, out.error, out.details);
  process.exit(1);
}

// Runtime — inspect per-node codes
for (const r of out.results) {
  if (!r.ok && r.status !== "skipped") {
    console.warn(`node ${r.nodeId}: ${r.code} after ${r.attempts} attempt(s)`);
  }
}
if (out.status === "partial") {
  console.log("Some nodes failed or were skipped — see out.ascii / out.summary");
}
```

---

### E10. Invalid `onDepFail` → `INVALID_POLICY`

```js
await runSwarmFanOut(cfg, {
  tasks: ["x"],
  onDepFail: "explode",
});
// { ok: false, code: "INVALID_POLICY", retryable: false }
```

Valid values: `skip-downstream` | `fail-fast` | `best-effort`.
