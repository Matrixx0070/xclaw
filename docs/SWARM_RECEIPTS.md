# Swarm node receipts (S1)

Every finished swarm node gets a **receipt**: durable proof of work for any domain.

## Location

```text
~/.xclaw/swarms/runs/<swarmId>/receipts/<nodeId>.json
```

## Fields (universal)

| Field | Meaning |
|-------|---------|
| ok / status / error | Outcome |
| role / fabricRole | Swarm + fabric role |
| effects | `shell`, `files`, `repo`, `browser`, … |
| tools | counts + recent tool names |
| artifacts | paths / workspaces mentioned |
| textPreview | short output |

Browser-only fields (`tabIds`, `actionIds`, `gateIds`) appear **only when relevant**.

## Node result attachment

```json
{
  "receiptId": "rcpt_…",
  "receiptPath": "/…/receipts/node.json",
  "receipt": { "id": "…", "ok": true, "effects": ["files"], "toolsTotal": 2 }
}
```

## Next (S2)

Merge/vote can require receipts when `XCLAW_SWARM_REQUIRE_RECEIPTS=1`.

## Node failure handling

| Outcome | status / code | Receipt? | Downstream |
|---------|---------------|----------|------------|
| Success | `done` | yes | may run |
| Spawn/runtime error | `error` + code | yes (after retries) | depends on `onDepFail` |
| Timeout | `timeout` | yes | same |
| Aborted | `ABORTED` | yes | swarm stops |
| Upstream failed | `skipped` / `UPSTREAM_FAILED` | yes | not run |
| Deps not ready | `skipped` / `DEPS_NOT_TERMINAL` | yes | wait/skip |

### `onDepFail` policy

| Policy | Behavior |
|--------|----------|
| **`skip-downstream`** (default) | Failed node → dependents marked skipped |
| **`fail-fast`** | First upstream failure → skip all remaining pending |
| **`best-effort`** | Run dependents even if upstream failed |

### Retries

Transient codes (`TIMEOUT`, `SPAWN_FAILED`, network-ish errors) retry with backoff (default up to 3 attempts).  
`ABORTED` and `skipped` are **not** retried.

## Configuring `onDepFail`

Controls what happens to **downstream** nodes when an upstream node fails.

| Value | Behavior |
|-------|----------|
| `skip-downstream` | **Default.** Dependents are skipped (receipt `UPSTREAM_FAILED`). |
| `fail-fast` | First failure → skip **all** remaining pending nodes; stop scheduling new work. |
| `best-effort` | Run dependents even if upstream failed (they still get upstream context marked failed). |

### Priority (highest wins)

1. **Per-run argument** — tool / API `onDepFail`
2. **Config** — `swarm.onDepFail` in `xclaw.json`
3. **Default** — `skip-downstream`

### Config file (`~/.xclaw/xclaw.json` or project config)

```json
{
  "swarm": {
    "enabled": true,
    "onDepFail": "fail-fast",
    "maxParallel": 3,
    "maxChildrenPerRun": 8,
    "nodeRetries": 2
  }
}
```

### Swarm tool (agent)

```json
{
  "goal": "Ship login fix",
  "onDepFail": "skip-downstream",
  "tasks": [
    { "id": "research", "role": "research", "task": "Find auth bug" },
    { "id": "implement", "role": "implement", "task": "Fix it", "dependsOn": ["research"] },
    { "id": "verify", "role": "verify", "task": "Run tests", "dependsOn": ["implement"] }
  ]
}
```

### Which policy to use

| Situation | Suggested policy |
|-----------|------------------|
| Normal feature DAG (research → implement → verify) | `skip-downstream` |
| Expensive / dangerous later nodes | `fail-fast` |
| Independent checks that should always run | `best-effort` |

Invalid values → swarm error `INVALID_POLICY`.


## S2 — Merge and vote use receipts

### Soft (default)
- Votes from nodes **with** receipts weigh more than those without
- Missing receipt weight ≈ `0.25×`; with tools/artifacts up to `1.5×`

### Hard
```bash
export XCLAW_SWARM_REQUIRE_RECEIPTS=1
# or in xclaw.json:
# "swarm": { "requireReceipts": true }
```
Merge gates **fail** if ok `implement` / `verify` / `critic` nodes lack receipts.

### Run summary
`receiptSummary` on the swarm run: counts ok/fail/skipped and how many have receipts.
