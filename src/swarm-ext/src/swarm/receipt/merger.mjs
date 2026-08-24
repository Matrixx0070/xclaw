/**
 * Receipt Merger — Merges multiple receipts (for batch operations)
 */
export class ReceiptMerger {
  merge(receipts) {
    if (!receipts.length) return null;

    const merged = {
      taskId: `batch_${receipts[0].taskId}`,
      status: receipts.every(r => r.status === "done") ? "done" : "partial",
      createdAt: receipts[0].createdAt,
      completedAt: new Date().toISOString(),
      plan: {
        reasoning: "Batch operation",
        estimatedSubAgents: receipts.reduce((s, r) => s + (r.plan?.estimatedSubAgents || 0), 0),
      },
      steps: receipts.flatMap(r => r.steps),
      toolsUsed: [...new Set(receipts.flatMap(r => r.toolsUsed))],
      tokenUsage: receipts.reduce((acc, r) => ({
        prompt: acc.prompt + (r.tokenUsage?.prompt || 0),
        completion: acc.completion + (r.tokenUsage?.completion || 0),
        total: acc.total + (r.tokenUsage?.total || 0),
      }), { prompt: 0, completion: 0, total: 0 }),
      durationMs: receipts.reduce((s, r) => s + (r.durationMs || 0), 0),
      diffs: receipts.flatMap(r => r.diffs || []),
      mergePolicy: "batch",
      confidenceScore: receipts.reduce((s, r) => s + (r.confidenceScore || 0), 0) / receipts.length,
      errors: receipts.flatMap(r => r.errors || []),
      version: "1.0",
    };

    return merged;
  }
}
