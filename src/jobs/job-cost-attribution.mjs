/**
 * Stamp per-model attribution onto job cost ledger events.
 */
import {
  emptyAttribution,
  attributeSpend,
  noteFailover,
  attributionSummary,
} from "../tokens/cost-attribution.mjs";

export function attributionFromJobResult(result = {}) {
  let attr = emptyAttribution();
  const usage = result.usage || {};
  const slices = result.costSlices || usage.byModel || [];
  if (Array.isArray(slices) && slices.length) {
    for (const s of slices) {
      attr = attributeSpend(attr, s.modelRef || s.model, s.usd, {
        jobId: result.id,
        reason: s.reason,
      });
    }
  } else {
    const model = result.model || result.modelRef || usage.model;
    const usd = Number(result.usd ?? usage.usd ?? 0);
    if (model || usd) {
      attr = attributeSpend(attr, model, usd, { jobId: result.id });
    }
  }
  if (result.failover) {
    attr = noteFailover(
      attr,
      result.failover.fromRef,
      result.failover.toRef,
      result.failover.remainingUsd
    );
  }
  return attr;
}

export function stampJobCostEvent({ usd, jobId, estimated = false, result = {} } = {}) {
  const attr = attributionFromJobResult({ ...result, id: jobId, usd });
  return {
    at: new Date().toISOString(),
    usd,
    jobId,
    estimated,
    attribution: attributionSummary(attr),
  };
}

export default { attributionFromJobResult, stampJobCostEvent };
