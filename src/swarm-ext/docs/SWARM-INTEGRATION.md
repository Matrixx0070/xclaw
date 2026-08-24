# Swarm Integration with XClaw

The Swarm is designed as a first-class extension to XClaw. It plugs into the existing gateway, TUI, and agent loop.

## Gateway Integration

The swarm routes are mounted at `/api/swarm/*` alongside XClaw's existing routes.

```javascript
// In your gateway setup
import swarmRoutes from "./src/gateway/routes/swarm.mjs";
import swarmBatchRoutes from "./src/gateway/routes/swarm-batch.mjs";
import swarmReceiptRoutes from "./src/gateway/routes/swarm-receipt.mjs";
import { setupSwarmWebSocket } from "./src/gateway/routes/swarm-ws.mjs";

app.use("/api/swarm", swarmRoutes);
app.use("/api/swarm", swarmBatchRoutes);
app.use("/api/swarm", swarmReceiptRoutes);

// WebSocket
setupSwarmWebSocket(wsServer);
```

## TUI Integration

In the XClaw TUI, swarm mode is triggered by:

```
/swarm "Research and summarize AI frameworks"
```

This:
1. Switches to swarm orchestrator
2. Streams progress via WebSocket
3. Displays the receipt on completion

## Agent Loop Integration

XClaw's single-agent loop can delegate to the swarm when it detects a task that benefits from parallelization:

```javascript
// In XClaw agent loop
if (goal.complexity > threshold && goal.canParallelize) {
  const swarm = new Orchestrator(llmClient, toolRegistry);
  const result = await swarm.submit({
    query: goal.description,
    maxSubAgents: estimateNeeded(goal),
    contextFiles: goal.contextFiles,
  });
  return result.finalResult;
}
```

## Computer Tool Integration

Swarm sub-agents share the same computer tool interface as XClaw:

- `bash` — Shell commands (sandboxed)
- `files` — File read/write
- `browser` — Web navigation
- `screen` — Screenshot capture

Each sub-agent gets its own sandboxed computer session.

## Session Memory

Swarm tasks are registered in XClaw's session manager:

```javascript
const manager = getSessionManager();
manager.registerTask(sessionId, taskId);
// Later:
const tasks = manager.getSessionTasks(sessionId);
```

## Receipt Export

Receipts can be exported to XClaw's transcript system:

```javascript
const receipt = await orch.submit(goal);
await xclaw.saveTranscript({
  sessionId,
  type: "swarm",
  receipt: receipt.receipt,
});
```

## Profile Mapping

| XClaw Profile | Swarm Behavior |
|---------------|----------------|
| `lab` | Auto-approve, max 300 agents, egress allow |
| `dev` | Ask for risky tools, max 50 agents, egress allowlist |
| `prod` | Strict approvals, max 10 agents, egress deny, token required |

## Configuration Merge

XClaw's `xclaw.json` and swarm's `xclaw-swarm.json` are merged at runtime:

```javascript
const xclawConfig = loadXClawConfig();
const swarmConfig = loadSwarmConfig();
const merged = deepMerge(xclawConfig, swarmConfig);
```

## Authentication

Swarm API uses the same `XCLAW_GATEWAY_TOKEN` as XClaw:

```bash
curl -H "Authorization: Bearer $XCLAW_GATEWAY_TOKEN" \
  http://localhost:18790/api/swarm/goals \
  -d '{"goal":"..."}'
```

## Error Handling

Swarm errors are wrapped in XClaw's error format:

```json
{
  "error": "Swarm execution failed",
  "details": {
    "phase": "aggregation",
    "subtaskId": "task_abc",
    "originalError": "LLM timeout"
  },
  "receipt": { ... }
}
```
