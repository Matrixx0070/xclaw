/**
 * Per-modelRef cost attribution (after provider failover).
 */

export function emptyAttribution() {
  return { byModel: {}, totalUsd: 0 };
}

export function attributeSpend(attr = emptyAttribution(), modelRef, usd, meta = {}) {
  const ref = String(modelRef || "unknown");
  const amount = Math.max(0, Number(usd) || 0);
  const next = {
    byModel: { ...(attr.byModel || {}) },
    totalUsd: Number(attr.totalUsd || 0) + amount,
    lastFailover: attr.lastFailover || null,
  };
  const cur = next.byModel[ref] || { usd: 0, calls: 0 };
  next.byModel[ref] = {
    usd: Number((cur.usd + amount).toFixed(6)),
    calls: cur.calls + 1,
    lastReason: meta.reason || cur.lastReason || null,
    lastJobId: meta.jobId || cur.lastJobId || null,
  };
  next.totalUsd = Number(next.totalUsd.toFixed(6));
  return next;
}

export function noteFailover(attr, fromRef, toRef, remainingUsd) {
  return {
    ...attr,
    lastFailover: {
      fromRef: fromRef || null,
      toRef: toRef || null,
      remainingUsd: remainingUsd ?? null,
      at: new Date().toISOString(),
    },
  };
}

export function attributionSummary(attr = emptyAttribution()) {
  const rows = Object.entries(attr.byModel || {}).map(([modelRef, v]) => ({
    modelRef,
    usd: v.usd,
    calls: v.calls,
  }));
  rows.sort((a, b) => b.usd - a.usd);
  return {
    totalUsd: attr.totalUsd || 0,
    models: rows,
    lastFailover: attr.lastFailover || null,
  };
}

export default {
  emptyAttribution,
  attributeSpend,
  noteFailover,
  attributionSummary,
};
