/**
 * Stamp budget/cost governor blocks onto job evidence/receipt.
 */
export function stampCostBlock(job = {}, detail = {}) {
  const entry = {
    type: "cost_governor",
    reason: detail.reason || "blocked",
    at: new Date().toISOString(),
    ...detail,
  };
  if (!job.evidence) job.evidence = [];
  job.evidence.push(entry);
  if (job.receipt && typeof job.receipt === "object") {
    job.receipt.costBlocks = job.receipt.costBlocks || [];
    job.receipt.costBlocks.push(entry);
  }
  if (job.receiptCollector && typeof job.receiptCollector === "object") {
    job.receiptCollector.costBlocks = job.receiptCollector.costBlocks || [];
    job.receiptCollector.costBlocks.push(entry);
  }
  return entry;
}

export default { stampCostBlock };
