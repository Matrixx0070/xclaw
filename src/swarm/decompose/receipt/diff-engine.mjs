/**
 * Diff Engine — Computes diffs between receipt versions
 * For tracking changes during iterative refinement
 */
export class DiffEngine {
  computeDiff(oldReceipt, newReceipt) {
    const changes = [];

    // Check status change
    if (oldReceipt.status !== newReceipt.status) {
      changes.push({
        type: "status",
        from: oldReceipt.status,
        to: newReceipt.status,
      });
    }

    // Check new steps
    const oldStepIds = new Set(oldReceipt.steps.map(s => s.agentId));
    for (const step of newReceipt.steps) {
      if (!oldStepIds.has(step.agentId)) {
        changes.push({
          type: "step_added",
          step,
        });
      }
    }

    // Check removed steps
    const newStepIds = new Set(newReceipt.steps.map(s => s.agentId));
    for (const step of oldReceipt.steps) {
      if (!newStepIds.has(step.agentId)) {
        changes.push({
          type: "step_removed",
          step,
        });
      }
    }

    // Check confidence change
    if (oldReceipt.confidenceScore !== newReceipt.confidenceScore) {
      changes.push({
        type: "confidence",
        from: oldReceipt.confidenceScore,
        to: newReceipt.confidenceScore,
        delta: newReceipt.confidenceScore - oldReceipt.confidenceScore,
      });
    }

    return changes;
  }

  generatePatch(receipt, changes) {
    return {
      receiptId: receipt.taskId,
      timestamp: new Date().toISOString(),
      changes,
      version: receipt.version,
    };
  }
}
