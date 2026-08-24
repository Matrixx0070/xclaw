# Execution Receipts

Every swarm execution produces an **immutable receipt** — a verifiable record of exactly what happened, when, and by whom.

## Why Receipts?

- **Auditability** — Prove what the swarm did
- **Reproducibility** — Re-run the same plan
- **Debugging** — See where things went wrong
- **Billing** — Track token usage per agent
- **Compliance** — Satisfy governance requirements

## Receipt Structure

```json
{
  "taskId": "task_abc123",
  "status": "done",
  "steps": [
    {
      "agentId": "agent_researcher_abc",
      "role": "researcher",
      "description": "Search for AI framework benchmarks",
      "status": "completed",
      "tools": ["web_search", "web_extract"],
      "resultPreview": "Found 12 relevant sources...",
      "error": null,
      "startedAt": "2026-08-24T12:00:00Z",
      "completedAt": "2026-08-24T12:00:15Z",
      "tokenUsage": { "prompt": 2048, "completion": 1024 }
    }
  ],
  "toolsUsed": ["web_search", "web_extract", "file_reader"],
  "durationMs": 45000,
  "tokenUsage": { "prompt": 15000, "completion": 8000 },
  "diffs": [
    {
      "type": "plan_change",
      "description": "Removed cyclic dependency researcher→analyst",
      "before": ["researcher", "analyst", "researcher"],
      "after": ["researcher", "analyst"]
    }
  ],
  "mergePolicy": "llm",
  "confidenceScore": 0.92
}
```

## Receipt Lifecycle

1. **Generation** — `ReceiptGenerator` builds the receipt during execution
2. **Validation** — `ReceiptValidator` checks schema compliance
3. **Diff** — `DiffEngine` records changes from the original plan
4. **Merge** — `ReceiptMerger` combines receipts from parallel branches
5. **Storage** — Receipts are stored in Redis and optionally exported

## Validation

```javascript
import { ReceiptValidator } from "@xclaw/swarm";

const validator = new ReceiptValidator();
const result = validator.validate(receipt);

if (!result.valid) {
  console.error("Receipt invalid:", result.errors);
}
```

Validation checks:
- Required fields present
- Timestamps are valid ISO 8601
- Token usage is non-negative
- Step statuses are valid enum values
- No duplicate agent IDs

## Diff Engine

Records deviations from the original plan:

| Diff Type | When |
|-----------|------|
| `plan_change` | Cycle broken, task reordered |
| `agent_substitution` | Fallback model used |
| `tool_fallback` | Tool failed, fallback used |
| `timeout` | Agent killed by watchdog |
| `budget_exceeded` | Task stopped due to budget |

## Export Formats

```javascript
// Markdown summary
const md = receipt.toMarkdown();

// JSON (full)
const json = JSON.stringify(receipt, null, 2);

// CSV (for spreadsheets)
const csv = receipt.toCSV();
```

## Storage

Receipts are stored in Redis with TTL:

```bash
# Default TTL: 7 days
# Configurable in xclaw-swarm.json:
# swarm.receipt.maxHistoryLength = 1000
```

For long-term storage, export to S3 or a database:

```javascript
await receipt.exportToS3({
  bucket: "xclaw-receipts",
  key: `receipts/${taskId}.json`,
});
```

## Receipt API

```bash
# Get receipt
curl http://localhost:18790/api/swarm/receipts/task_abc123

# Validate receipt
curl -X POST http://localhost:18790/api/swarm/receipts/task_abc123/validate \
  -H "Content-Type: application/json" \
  -d @receipt.json
```
