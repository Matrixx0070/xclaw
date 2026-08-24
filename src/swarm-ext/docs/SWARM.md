# XClaw Agent Swarm

> Production-grade multi-agent parallel orchestration for XClaw.

## What is the Swarm?

The **XClaw Agent Swarm** extends XClaw with the ability to decompose a single high-level goal into many parallel subtasks, execute them across up to 300 concurrent sub-agents, and intelligently merge the results.

It is not a thin wrapper around a single LLM call — it is a full **distributed execution engine** with:

- **DAG-based planning** with automatic cycle detection and breaking
- **Execution groups** that maximize parallelism while respecting dependencies
- **Redis-backed task queues** for durability and horizontal scaling
- **Multiple merge strategies** (LLM, vote, quorum, concat)
- **Execution receipts** for auditability and reproducibility
- **PARL training** — learns from successful plans to improve future decomposition
- **Heartbeat + watchdog** for fault tolerance
- **Budget tracking** for cost control
- **MCP gateway** for external tool server integration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     User Goal                                │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Orchestrator (1 per session)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Planner    │  │  DAG Engine │  │ Result Aggregator   │  │
│  │  (LLM)      │  │  (Graph)    │  │  (Merge Policy)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │ spawns
┌────────────────────▼────────────────────────────────────────┐
│              Sub-Agent Pool (up to 300 concurrent)           │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        ┌─────┐           │
│  │Agent│ │Agent│ │Agent│ │Agent│  ...   │Agent│           │
│  │ #1  │ │ #2  │ │ #3  │ │ #4  │        │#300 │           │
│  └─────┘ └─────┘ └─────┘ └─────┘        └─────┘           │
└────────────────────┬────────────────────────────────────────┘
                     │ results
┌────────────────────▼────────────────────────────────────────┐
│              Redis (Queue + Pub/Sub + Memory)                │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install

```bash
cd xclaw-swarm-extension
npm install
```

### 2. Start Redis

```bash
npm run swarm:redis
# or manually: redis-server docker/redis.conf
```

### 3. Run the Doctor

```bash
npm run swarm:doctor
```

### 4. Submit a Goal

```bash
node -e "
const { Orchestrator } = require('./src/swarm');
const orch = new Orchestrator(llmClient, toolRegistry);
orch.submit({
  query: 'Research the latest trends in AI agent frameworks and write a summary',
  maxSubAgents: 10,
  outputFormat: 'markdown'
}).then(r => console.log(r));
"
```

### 5. Via Gateway API

```bash
curl -X POST http://localhost:18790/api/swarm/goals \
  -H "Content-Type: application/json" \
  -d '{"goal":"Analyze this codebase for security issues","sessionId":"demo"}'
```

## Core Concepts

### Orchestrator
The single entry point per session. It:
1. Receives the goal
2. Shards context files (if any)
3. Decomposes into subtasks via LLM
4. Validates the dependency DAG
5. Builds execution groups
6. Spawns sub-agents via the pool
7. Aggregates results
8. Generates a receipt

### Sub-Agent
A lightweight agent that executes one subtask. Features:
- Tool-calling loop with retry logic
- Token usage tracking
- Sandbox isolation (Docker)
- Heartbeat registration
- Automatic timeout handling

### DAG Engine
Builds a directed acyclic graph from subtask dependencies:
- **Cycle detection** via DFS
- **LLM-assisted cycle breaking** (with heuristic fallback)
- **Topological sort** for execution order
- **Execution groups** — batches of tasks that can run in parallel

### Merge Policies
| Mode | When to Use | Description |
|------|-------------|-------------|
| `llm` | Default | LLM synthesizes a coherent result from all outputs |
| `concat` | Simple aggregation | Concatenates all results with headers |
| `vote` | Consensus tasks | Takes the most frequent answer |
| `quorum` | High-confidence tasks | Requires ≥N agents to agree |

### Receipts
Every swarm execution produces a **receipt** — an immutable, verifiable record of:
- Every sub-agent that ran
- Every tool call made
- Token usage per agent
- Execution timeline
- Diffs between planned and actual execution

## Configuration

See `xclaw-swarm.json` for full configuration. Key sections:

- `orchestrator` — planning model, limits, timeouts
- `subAgent` — concurrency, sandbox, retry
- `taskQueue` — Redis backend settings
- `mergePolicy` — default merge mode
- `receipt` — receipt generation options
- `parl` — training sample collection
- `heartbeat` / `watchdog` — fault tolerance
- `budget` — cost controls
- `telemetry` — Prometheus metrics

## Environment Variables

Copy `.env.swarm.example` to `.env` and set:

```bash
REDIS_URL=redis://localhost:6379/0
REDIS_RESULT_URL=redis://localhost:6379/1
XAI_API_KEY=your-key
OPENAI_API_KEY=your-key
```

## Further Reading

- [SWARM-API.md](SWARM-API.md) — REST and WebSocket API reference
- [SWARM-DEPLOYMENT.md](SWARM-DEPLOYMENT.md) — Docker, K8s, scaling
- [SWARM-INTEGRATION.md](SWARM-INTEGRATION.md) — Integrating with XClaw
- [SWARM-MCP.md](SWARM-MCP.md) — MCP server integration
- [SWARM-RECEIPTS.md](SWARM-RECEIPTS.md) — Receipt format and validation
- [SWARM-ADVANCED.md](SWARM-ADVANCED.md) — Custom merge strategies, PARL tuning
