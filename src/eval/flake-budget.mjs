/**
 * Eval flake budget — fail CI when flake rate exceeds threshold.
 */

export const DEFAULT_FLAKE_BUDGET = Object.freeze({
  maxRate: 0.02,
  maxAbsolute: 1,
  minCasesForRate: 50,
});

export function resolveFlakeBudget(cfg = {}) {
  const f = cfg.eval?.flake || cfg.flake || {};
  return {
    maxRate: Number(f.maxRate) > 0 ? Number(f.maxRate) : DEFAULT_FLAKE_BUDGET.maxRate,
    maxAbsolute:
      f.maxAbsolute != null ? Number(f.maxAbsolute) : DEFAULT_FLAKE_BUDGET.maxAbsolute,
    minCasesForRate:
      Number(f.minCasesForRate) > 0
        ? Number(f.minCasesForRate)
        : DEFAULT_FLAKE_BUDGET.minCasesForRate,
  };
}

export function evaluateFlakeBudget(counts = {}, cfg = {}) {
  const budget = resolveFlakeBudget(cfg);
  const total = Math.max(0, Number(counts.totalCases) || 0);
  const flakes = Math.max(0, Number(counts.flakeCount) || 0);
  const rate = total > 0 ? flakes / total : null;

  if (total >= budget.minCasesForRate) {
    if (rate != null && rate > budget.maxRate) {
      return {
        ok: false,
        flakeRate: rate,
        flakeCount: flakes,
        totalCases: total,
        reason: `flake rate ${(rate * 100).toFixed(2)}% > max ${(budget.maxRate * 100).toFixed(2)}%`,
        budget,
      };
    }
  } else if (flakes > budget.maxAbsolute) {
    return {
      ok: false,
      flakeRate: rate,
      flakeCount: flakes,
      totalCases: total,
      reason: `flake count ${flakes} > maxAbsolute ${budget.maxAbsolute} (n=${total} < ${budget.minCasesForRate})`,
      budget,
    };
  }

  return {
    ok: true,
    flakeRate: rate,
    flakeCount: flakes,
    totalCases: total,
    reason: null,
    budget,
  };
}

export function countFlakesFromAttempts(attempts = []) {
  const byId = new Map();
  for (const a of attempts) {
    const id = String(a.id || a.name || "unknown");
    if (!byId.has(id)) byId.set(id, { pass: 0, fail: 0 });
    const s = byId.get(id);
    if (a.pass) s.pass += 1;
    else s.fail += 1;
  }
  let flakes = 0;
  const totalCases = byId.size;
  for (const s of byId.values()) {
    if (s.pass > 0 && s.fail > 0) flakes += 1;
  }
  return { totalCases, flakeCount: flakes, byId };
}

export default {
  DEFAULT_FLAKE_BUDGET,
  resolveFlakeBudget,
  evaluateFlakeBudget,
  countFlakesFromAttempts,
};
