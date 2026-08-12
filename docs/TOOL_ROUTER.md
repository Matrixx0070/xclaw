# Tool Router

## Status

| Phase | State |
|-------|--------|
| **T0** Inventory + plane map + contract | **Done** (`src/tools/planes.mjs`) |
| **T1** `router.mjs` + agent loop wire | **Done** |
| **T2** Batch concurrency + abort | **Done** |
| **T3** Computer-only for heavy tools | **Done** |

## Flow (target)

```text
Agent loop
  → authorize / systemRunPlan revalidate
  → Tool Router.dispatch(ToolCallRequest)
       → plane adapter (computer | local | search | mcp)
  → ToolCallResult
```

Meta tools (`agent` plane: spawn subagent, recall) stay in the loop — not routed to computer.

## Planes

| Plane | Responsibility |
|-------|----------------|
| **computer** | bash, files, browser (thin/native or CDP bundle) |
| **local** | in-process media, finance, host utils, images |
| **search** | allowlisted web search only (no shell) |
| **mcp** | MCP / connected tool servers |
| **agent** | loop-internal meta tools |

## Contract

### `ToolCallRequest`

- `callId`, `sessionId`, `name`, `args?`
- `plan?` — frozen systemRunPlan (bash spawn enforce)
- `timeoutMs?`, `signal?` (session kill-switch)
- `workingDir?`, `cfg?`

### `ToolCallResult`

- `callId`, `name`, `plane`, `ok`
- `result?` | `error?`, `durationMs?`, `blocked?`

## Concurrency

- **parallel-safe** — reads, search, ocr, list, …
- **serial** — bash, writes, browser mutations

`partitionByConcurrency(calls)` splits a model tool batch.

## Security

Router **does not** replace approvals or plan binding. Order remains:

1. Approve / auto-approve policy  
2. Revalidate plan (exec tools)  
3. `router.dispatch`  
4. Plane executes (computer applies spawn enforce + optional bwrap)

## Code

- Classification: `src/tools/planes.mjs`
- Router (T1): `src/tools/router.mjs` (not yet)


## T1 implementation

- `src/tools/router.mjs` — `createToolRouter({ computer, sessionId, localTools, agentHandlers }).dispatch(req)`
- Agent loop: local + computer paths go through `toolRouter.dispatch`
- Plan carried as `args.systemRunPlan` for spawn enforce
- `AbortSignal` → blocked result when aborted
- Tests: `test/tool-router.test.mjs`


## T2 concurrency

- `src/agent/tool-concurrency.mjs` — plane-aligned `isParallelSafeTool`, `runToolBatches`
- Cap: `cfg.tools.maxParallel` or `XCLAW_TOOLS_MAX_PARALLEL` (default **4**)
- Parallel batches split into chunks; abort checked between chunks
- Loop uses `runToolBatches(calls, { processFn, signal, cfg, onEvent })`


## T3 computer-only

- Bash, files, browser tools **must** use the computer plane
- No in-process local fallback if computer is down → blocked error
- `isComputerOnlyTool()` / `COMPUTER_ONLY_TOOLS` in `planes.mjs`
- Doctor: `tools.computerOnly`
