/**
 * Rehydrate receipt collector fields from a checkpoint blob.
 */
export function rehydrateReceiptFromCheckpoint(job, checkpoint) {
  if (!job || !checkpoint) return job;
  const src = checkpoint.job || checkpoint;
  if (src.quotaEscalate) job.quotaEscalate = job.quotaEscalate || src.quotaEscalate;
  if (src.quotaHardCircuit) job.quotaHardCircuit = job.quotaHardCircuit || src.quotaHardCircuit;
  if (src.receiptCollector) {
    job.receiptCollector = job.receiptCollector || src.receiptCollector;
  } else if (src.quotaEscalate || src.quotaHardCircuit) {
    job.receiptCollector = job.receiptCollector || {
      quotaEscalate: src.quotaEscalate || null,
      quotaHardCircuit: src.quotaHardCircuit || null,
    };
  }
  return job;
}

export default { rehydrateReceiptFromCheckpoint };
