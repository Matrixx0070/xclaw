/**
 * Claims soft-retry budget — how many grounding rescues a job may burn.
 * Surfaced on job receipts as claimsSoftRetry / claimsGate.softRetryBudget.
 */

export function resolveClaimsSoftRetryMax(cfg = {}, opts = {}) {
  if (opts.claimsSoftRetry === false || cfg?.jobs?.claimsSoftRetry === false) {
    return 0;
  }
  const n = Number(
    opts.claimsSoftRetryMax ??
      cfg?.jobs?.claimsSoftRetryMax ??
      1
  );
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.floor(n);
}

/**
 * @param {object} [opts]
 * @param {object} [opts.cfg]
 * @param {number} [opts.max]
 */
export function createClaimsSoftRetryBudget(opts = {}) {
  const max = opts.max != null ? Number(opts.max) : resolveClaimsSoftRetryMax(opts.cfg || {}, opts);
  const state = {
    max: Number.isFinite(max) && max >= 0 ? Math.floor(max) : 1,
    used: 0,
    attempts: [],
  };

  return {
    get max() {
      return state.max;
    },
    get used() {
      return state.used;
    },
    get remaining() {
      return Math.max(0, state.max - state.used);
    },
    record(meta = {}) {
      if (state.used >= state.max) {
        return { ok: false, reason: "budget_exhausted", ...snapshot(state) };
      }
      state.used += 1;
      state.attempts.push({
        at: new Date().toISOString(),
        warningCount: meta.warningCount ?? meta.warnings?.length ?? 0,
        warnings: (meta.warnings || []).slice(0, 5),
        ...meta,
      });
      return { ok: true, ...snapshot(state) };
    },
    snapshot() {
      return snapshot(state);
    },
  };
}

function snapshot(state) {
  return {
    max: state.max,
    used: state.used,
    remaining: Math.max(0, state.max - state.used),
    attempts: state.attempts.map((a) => ({ ...a })),
  };
}

/**
 * Stamp budget onto job receipt (and nested claimsGate when present).
 */
export function stampClaimsSoftRetryOnJob(job, budget) {
  if (!job || !budget) return job;
  const snap = typeof budget.snapshot === "function" ? budget.snapshot() : budget;
  job.claimsSoftRetry = snap;
  if (job.claimsGate && typeof job.claimsGate === "object") {
    job.claimsGate = { ...job.claimsGate, softRetryBudget: snap };
  }
  return job;
}

export default {
  resolveClaimsSoftRetryMax,
  createClaimsSoftRetryBudget,
  stampClaimsSoftRetryOnJob,
};
