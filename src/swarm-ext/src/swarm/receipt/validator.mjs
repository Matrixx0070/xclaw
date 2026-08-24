/**
 * Receipt Validator — Validates receipt integrity and completeness
 */
export class ReceiptValidator {
  validate(receipt) {
    const errors = [];

    if (!receipt.taskId) errors.push("Missing taskId");
    if (!receipt.createdAt) errors.push("Missing createdAt");
    if (!Array.isArray(receipt.steps)) errors.push("Steps must be an array");
    if (!Array.isArray(receipt.toolsUsed)) errors.push("toolsUsed must be an array");
    if (typeof receipt.confidenceScore !== "number") errors.push("confidenceScore must be a number");

    // Validate steps
    for (let i = 0; i < (receipt.steps || []).length; i++) {
      const step = receipt.steps[i];
      if (!step.agentId) errors.push(`Step ${i}: Missing agentId`);
      if (!step.status) errors.push(`Step ${i}: Missing status`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  compareReceipts(receiptA, receiptB) {
    const diffs = [];

    // Compare steps
    const stepsA = new Map(receiptA.steps.map(s => [s.agentId, s]));
    const stepsB = new Map(receiptB.steps.map(s => [s.agentId, s]));

    for (const [id, stepA] of stepsA) {
      const stepB = stepsB.get(id);
      if (!stepB) {
        diffs.push({ type: "removed", agentId: id, step: stepA });
      } else if (stepA.status !== stepB.status) {
        diffs.push({ type: "status_changed", agentId: id, from: stepA.status, to: stepB.status });
      }
    }

    for (const [id, stepB] of stepsB) {
      if (!stepsA.has(id)) {
        diffs.push({ type: "added", agentId: id, step: stepB });
      }
    }

    return diffs;
  }
}
