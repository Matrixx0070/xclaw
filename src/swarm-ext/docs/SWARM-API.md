# Swarm API Reference

The Swarm exposes a REST API (mounted at `/api/swarm/*`) and a WebSocket endpoint for real-time progress.

## REST Endpoints

### POST /api/swarm/goals
Submit a new goal for swarm execution.

**Request:**
```json
{
  "goal": "Research and summarize AI agent frameworks",
  "sessionId": "default",
  "profile": "lab",
  "context": {
    "files": ["docs/context.md"],
    "history": [],
    "computerState": {}
  },
  "constraints": {
    "maxSubAgents": 10,
    "timeoutSeconds": 600,
    "autoApprove": true,
    "egress": "allow"
  },
  "outputFormat": "markdown"
}
```

**Response (202 Accepted):**
```json
{
  "id": "task_abc123",
  "status": "pending",
  "message": "Goal accepted. Poll GET /api/swarm/tasks/:id for results.",
  "pollInterval": 2000
}
```

### GET /api/swarm/tasks/:id
Get task status, progress, and results.

**Response:**
```json
{
  "id": "task_abc123",
  "status": "running",
  "result": {
    "summary": "...",
    "content": "...",
    "artifacts": [],
    "confidence": 0.92
  },
  "receipt": { ... },
  "swarm": {
    "subAgents": 8,
    "parallelRatio": 0.75,
    "planReasoning": "...",
    "executionGroups": 3
  },
  "progress": {
    "completed": 5,
    "failed": 0,
    "total": 8
  },
  "durationMs": 45000,
  "tokenUsage": { "prompt": 12000, "completion": 8000 },
  "error": null
}
```

### POST /api/swarm/tasks/:id/cancel
Cancel a running task.

**Response:**
```json
{
  "taskId": "task_abc123",
  "cancelled": true
}
```

### GET /api/swarm/health
Swarm health check.

**Response:**
```json
{
  "status": "healthy",
  "checks": {
    "redis": true,
    "orchestrator": true,
    "subAgentPool": true
  },
  "config": { "maxSubAgents": 300, "maxConcurrent": 300 },
  "timestamp": "2026-08-24T13:00:00Z"
}
```

### GET /api/swarm/stats
Per-session orchestrator statistics.

### GET /api/swarm/sessions
List active sessions.

### POST /api/swarm/batch
Submit multiple goals as a batch (max 100).

**Request:**
```json
{
  "goals": [
    { "goal": "Task 1", "sessionId": "s1" },
    { "goal": "Task 2", "sessionId": "s2" }
  ],
  "profile": "lab"
}
```

### GET /api/swarm/receipts/:taskId
Retrieve execution receipt.

### POST /api/swarm/receipts/:taskId/validate
Validate a receipt against the schema.

**Request:** Receipt JSON body.

**Response:**
```json
{
  "taskId": "task_abc123",
  "valid": true,
  "errors": []
}
```

## WebSocket

Connect to `/ws?taskId=<id>&sessionId=<id>` for real-time progress.

**Messages from server:**
```json
{ "type": "status", "message": "Decomposing task...", "step": 2, "total": 7 }
{ "type": "agent_progress", "agentId": "agent_researcher_abc", "status": "completed", "group": 1 }
{ "type": "completed", "taskId": "task_abc123", "durationMs": 45000 }
```

**Client → Server:**
- Send `"ping"` → receive `{ "type": "pong" }`

## JavaScript SDK

```javascript
import { Orchestrator } from "@xclaw/swarm";

const orch = new Orchestrator(llmClient, toolRegistry);

// Submit and await
const result = await orch.submit({
  query: "Analyze this repo",
  maxSubAgents: 5,
  outputFormat: "json"
});

// Or submit and poll
const task = await orch.submit(goal, sessionId);
// Poll orch.getTask(taskId) until status === "completed"
```

## Error Codes

| HTTP | Meaning |
|------|---------|
| 400 | Invalid request (missing goal, bad params) |
| 404 | Task or session not found |
| 500 | Internal error (LLM failure, Redis down) |
| 503 | Swarm overloaded (max concurrent reached) |
