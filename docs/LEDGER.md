# Operational Ledger — the durable black box

Every tool execution (including denials), policy decision, verification result,
merge, phase transition, failure/recovery and self-deploy is journaled as one
JSONL line under `~/.xclaw/ledger/YYYY-MM-DD.jsonl`. Correlation ids
(`sessionId`, `jobId`, `missionId`, `swarmId`, `nodeId`) make the operational
graph emerge from joins — there is deliberately no graph database.

## Envelope

```json
{ "v": 1, "ts": "…", "kind": "tool|policy|verify|merge|phase|failure|recovery|deploy|risk",
  "ids": { "sessionId": "…", "missionId": "…" }, "actor": "agent|operator|sla|supervisor",
  "data": { } }
```

`kind:"tool"` data is the finalized toolTrace entry **minus** raw args and
result text (transcripts hold the text; `argsSummary` is the durable form) plus
`effects` tags (shell/files/browser/repo/network). Policy denials from every
gate phase (filter → hook → approval → plan-revalidate → sandbox → egress) are
recorded — including the calls `post_tool_use` hooks never see.

## Where entries come from

- Agent loop: every finalized trace entry (`src/agent/loop.mjs` `recordTrace`).
- Missions: phase timings, verify results, repair/rollback recovery, merge file
  lists (`src/missions/engine.mjs` `mledger`).
- Approvals: every human and SLA decision (`src/security/approvals.mjs`).
- Subagents/jobs thread `nodeId`/`swarmId`/`jobId` via `runAgentLoop`'s
  `ledgerIds` option.

Appends are best-effort and never block execution; failures are counted in
`GET /ledger/stats`.

## Query surface

```
xclaw ledger tail [--since 1d] [--kind tool] [--mission id] [--status fail]
xclaw ledger query --mission msn_x --kind verify --since 7d
xclaw ledger who-touched src/app.mjs        # attribution join (writes + merges)
xclaw ledger stats · xclaw ledger compact [--keep-days N]

GET /ledger?missionId=&kind=&since=&limit=   · GET /ledger/stats
GET /ledger/who-touched?path=…
```

## Config

```json
{ "ledger": { "enabled": true, "retentionDays": 90, "maxPerMin": 0 } }
```

`maxPerMin` (0 = off) samples only ok-status read-family tool entries under
storms; policy/failure/blocked entries are never sampled away. Day segmentation
is the rotation; `compact` deletes segments older than the retention window.

