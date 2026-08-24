# Advanced Swarm Topics

## Custom Merge Strategies

Implement the `MergeStrategy` interface:

```javascript
export class MyMergeStrategy {
  async merge(results, originalQuery, outputFormat) {
    // results: array of sub-agent outputs
    // Return: { summary, detailedResult, artifacts, confidenceScore }
    return {
      summary: "...",
      detailedResult: "...",
      artifacts: [],
      confidenceScore: 0.95,
    };
  }
}
```

Register in `ResultAggregator`:

```javascript
aggregator.mergers["my_strategy"] = new MyMergeStrategy();
```

## PARL Training

PARL (Plan Auto-Regressive Learning) collects training samples from successful executions:

```javascript
import { PARLTrainer } from "@xclaw/swarm";

const trainer = new PARLTrainer(llmClient);

// After successful execution
trainer.recordSample({
  query: goal,
  plan: orchestratorPlan,
  reward: 85, // 0-100
  executionTime: 45000,
  success: true,
  feedback: "Good decomposition, but could parallelize more",
});

// Train when enough samples collected
if (trainer.sampleCount >= 10) {
  await trainer.train();
}
```

Samples are exported to `./data/parl-samples.jsonl`.

## Context Sharding

For large context files, the swarm shards them across sub-agents:

```javascript
import { ContextSharder } from "@xclaw/swarm";

const sharder = new ContextSharder({
  shardSize: 16000,    // tokens per shard
  overlap: 2000,       // overlap between shards
  vectorStore: "redis",
});

const shards = await sharder.shardFiles(["large-document.md"]);
// shards[0] → agent 1, shards[1] → agent 2, etc.
```

## Cycle Detection Customization

The DAG engine uses LLM-assisted cycle breaking by default. To use only the heuristic fallback:

```javascript
const dag = new DAGEngine(null); // no LLM client
const { tasks } = await dag.detectAndBreakCycles(plan);
```

## Watchdog Tuning

```javascript
// In xclaw-swarm.json
{
  "watchdog": {
    "taskTimeoutSeconds": 1800,    // 30 min per task
    "agentTimeoutSeconds": 600,     // 10 min per agent
    "cleanupIntervalSeconds": 60    // cleanup every minute
  }
}
```

## Heartbeat Strategies

- `exponential` — Backoff doubles on each failure (default)
- `linear` — Fixed increment
- `fixed` — No backoff

```json
{
  "heartbeat": {
    "intervalSeconds": 30,
    "maxConsecutiveFailures": 10,
    "backoffStrategy": "exponential"
  }
}
```

## Budget Alerts

```javascript
const budget = new BudgetTracker(sessionId, {
  maxTokens: 100000,
  maxCost: 5.0,
  currency: "USD",
  alertThreshold: 0.8, // alert at 80%
});

budget.onAlert = (usage) => {
  console.warn(`Budget 80% used: ${usage.tokens} tokens, $${usage.cost}`);
};
```

## Plugin Development

See `plugins/` for examples. A plugin needs:

1. `xclaw.plugin.json` — Manifest
2. `SKILL.md` — Documentation
3. `tool.mjs` — Implementation

## Performance Tuning

| Bottleneck | Solution |
|------------|----------|
| Redis latency | Use Redis Cluster or local Unix socket |
| LLM rate limits | Add retry with jitter, use fallback models |
| Sub-agent startup | Pre-warm Docker images, use process sandbox |
| Context too large | Enable sharding, increase overlap |
| Merge quality | Use `quorum` or `llm` mode, increase confidence threshold |

## Debugging

```bash
# Enable verbose logging
DEBUG=swarm:* node src/swarm/index.mjs

# Run doctor
npm run swarm:doctor

# Check a specific task
node -e "
const { getTaskQueue } = require('./src/swarm');
getTaskQueue().then(q => q.getQueueMetrics('task_abc')).then(m => console.log(m));
"
```
