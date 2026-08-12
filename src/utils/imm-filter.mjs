/**
 * Interacting Multiple Model (IMM) filter — scalar (1D) random-walk bank.
 *
 * Classic Blom / Bar-Shalom IMM cycle per step:
 *   1. Interaction / mixing   (mix state + covariance with μ and π)
 *   2. Model-conditioned KF   (predict + update per model)
 *   3. Likelihood             (Gaussian innovation)
 *   4. Mode probability update
 *   5. Output combination
 *
 * Models differ by process noise Q (e.g. "smooth" vs "agile").
 * Shared measurement noise R by default; can override per model.
 *
 * Use for adaptive smoothing of noisy scalar series (RTT, delay, etc.).
 */

/**
 * @typedef {object} ImmModel
 * @property {string} [id]
 * @property {number} q          process noise variance
 * @property {number} [r]        measurement noise variance (falls back to filter r)
 */

/**
 * @typedef {object} ImmState
 * @property {number[]} x        per-model state estimates
 * @property {number[]} P        per-model covariances
 * @property {number[]} mu       mode probabilities (sum=1)
 * @property {number} estimate   combined mean
 * @property {number} variance   combined variance
 */

/**
 * Log-sum-exp for stable likelihood normalization.
 * @param {number[]} logW
 */
function logSumExp(logW) {
  let m = -Infinity;
  for (const v of logW) if (v > m) m = v;
  if (!Number.isFinite(m)) return -Infinity;
  let s = 0;
  for (const v of logW) s += Math.exp(v - m);
  return m + Math.log(s);
}

/**
 * Create an IMM filter.
 *
 * @param {object} opts
 * @param {ImmModel[]} opts.models          at least 2 models with distinct q
 * @param {number} [opts.r=1e6]             default measurement noise variance
 * @param {number[][]} [opts.transition]    π[i][j] = P(mode_j | mode_i); default sticky
 * @param {number[]} [opts.mu0]             initial mode probs
 * @param {number} [opts.x0]                initial state (all models)
 * @param {number} [opts.P0=1e4]            initial covariance
 * @param {number} [opts.minMu=1e-12]       floor on mode probability
 */
export function createImmFilter(opts = {}) {
  const models = (opts.models || []).map((m, i) => ({
    id: m.id || `m${i}`,
    q: Number(m.q),
    r: m.r != null ? Number(m.r) : null,
  }));
  if (models.length < 2) {
    throw new TypeError("createImmFilter: need at least 2 models");
  }
  for (const m of models) {
    if (!(m.q >= 0) || !Number.isFinite(m.q)) {
      throw new TypeError(`invalid q for model ${m.id}`);
    }
  }

  const n = models.length;
  const rDefault = opts.r != null ? Number(opts.r) : 1e6;
  const minMu = opts.minMu != null ? Number(opts.minMu) : 1e-12;
  const P0 = opts.P0 != null ? Number(opts.P0) : 1e4;
  const x0 = opts.x0 != null ? Number(opts.x0) : 0;

  /** Transition π[i][j]: from i → j */
  let pi = opts.transition;
  if (!pi) {
    // Sticky: 0.9 stay, rest uniform jump
    const stay = 0.9;
    const jump = (1 - stay) / (n - 1);
    pi = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? stay : jump))
    );
  }
  if (pi.length !== n || pi.some((row) => row.length !== n)) {
    throw new TypeError("transition matrix must be n×n");
  }

  let mu =
    opts.mu0 && opts.mu0.length === n
      ? normalize(opts.mu0.map(Number), minMu)
      : normalize(Array(n).fill(1 / n), minMu);

  let x = Array(n).fill(x0);
  let P = Array(n).fill(P0);
  let initialized = opts.x0 != null;

  function normalize(v, floor) {
    const w = v.map((a) => Math.max(floor, a));
    const s = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((a) => a / s);
  }

  /**
   * One IMM cycle with measurement z.
   * @param {number} z
   * @returns {ImmState & { likelihoods: number[], mixed: boolean }}
   */
  function step(z) {
    const zz = Number(z);
    if (!Number.isFinite(zz)) {
      throw new TypeError("IMM step: z must be finite");
    }

    if (!initialized) {
      for (let i = 0; i < n; i++) {
        x[i] = zz;
        P[i] = P0;
      }
      initialized = true;
    }

    // --- 1. Mixing probabilities μ_{i|j} ---
    // c_j = sum_i π_{ij} μ_i
    const c = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        c[j] += pi[i][j] * mu[i];
      }
      c[j] = Math.max(c[j], minMu);
    }
    // μ_{i|j} = π_{ij} μ_i / c_j
    const muMix = Array.from({ length: n }, () => Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        muMix[i][j] = (pi[i][j] * mu[i]) / c[j];
      }
    }

    // --- 1b. Mixed state & covariance for each target model j ---
    const x0j = Array(n).fill(0);
    const P0j = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      let xMix = 0;
      for (let i = 0; i < n; i++) xMix += muMix[i][j] * x[i];
      x0j[j] = xMix;
      let pMix = 0;
      for (let i = 0; i < n; i++) {
        const dx = x[i] - xMix;
        pMix += muMix[i][j] * (P[i] + dx * dx);
      }
      P0j[j] = Math.max(pMix, 1e-12);
    }

    // --- 2. Model-conditioned filters (random-walk KF) ---
    const likelihoods = Array(n).fill(0);
    const logL = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      const q = models[j].q;
      const r = models[j].r != null ? models[j].r : rDefault;

      // predict from mixed prior
      const xPred = x0j[j];
      const PPred = P0j[j] + q;

      // update
      const innov = zz - xPred;
      const S = Math.max(PPred + r, 1e-12);
      const K = PPred / S;
      x[j] = xPred + K * innov;
      P[j] = Math.max((1 - K) * PPred, 1e-12);

      // log N(innov; 0, S)
      logL[j] =
        -0.5 * Math.log(2 * Math.PI * S) - (0.5 * innov * innov) / S;
    }

    // --- 3–4. Mode probability update: μ_j ∝ L_j * c_j ---
    const logMu = [];
    for (let j = 0; j < n; j++) {
      logMu.push(logL[j] + Math.log(Math.max(c[j], minMu)));
    }
    const lse = logSumExp(logMu);
    for (let j = 0; j < n; j++) {
      mu[j] = Math.exp(logMu[j] - lse);
      likelihoods[j] = Math.exp(logL[j]);
    }
    mu = normalize(mu, minMu);

    // --- 5. Combined output ---
    let estimate = 0;
    for (let j = 0; j < n; j++) estimate += mu[j] * x[j];
    let variance = 0;
    for (let j = 0; j < n; j++) {
      const dx = x[j] - estimate;
      variance += mu[j] * (P[j] + dx * dx);
    }

    return {
      x: x.slice(),
      P: P.slice(),
      mu: mu.slice(),
      estimate,
      variance,
      likelihoods,
      models: models.map((m) => m.id),
    };
  }

  /**
   * Filter an entire series.
   * @param {number[]} zs
   * @returns {{ estimates: number[], mus: number[][], variances: number[] }}
   */
  function filter(zs) {
    const estimates = [];
    const mus = [];
    const variances = [];
    for (const z of zs) {
      const s = step(z);
      estimates.push(s.estimate);
      mus.push(s.mu.slice());
      variances.push(s.variance);
    }
    return { estimates, mus, variances };
  }

  function getState() {
    let estimate = 0;
    for (let j = 0; j < n; j++) estimate += mu[j] * x[j];
    let variance = 0;
    for (let j = 0; j < n; j++) {
      const dx = x[j] - estimate;
      variance += mu[j] * (P[j] + dx * dx);
    }
    return {
      x: x.slice(),
      P: P.slice(),
      mu: mu.slice(),
      estimate,
      variance,
    };
  }

  function reset(newX0) {
    const v = newX0 != null ? Number(newX0) : x0;
    x = Array(n).fill(Number.isFinite(v) ? v : 0);
    P = Array(n).fill(P0);
    mu = opts.mu0 && opts.mu0.length === n
      ? normalize(opts.mu0.map(Number), minMu)
      : normalize(Array(n).fill(1 / n), minMu);
    initialized = newX0 != null;
  }

  return {
    step,
    filter,
    getState,
    reset,
    models: models.map((m) => ({ ...m })),
    transition: pi.map((row) => row.slice()),
  };
}

/**
 * Convenience: 2-model smooth vs agile IMM for delay/RTT smoothing.
 * @param {object} [opts]
 * @param {number} [opts.qSmooth=1e3]
 * @param {number} [opts.qAgile=1e6]
 * @param {number} [opts.r=1e6]
 * @param {number} [opts.x0]
 */
export function createDelayImm(opts = {}) {
  return createImmFilter({
    models: [
      { id: "smooth", q: opts.qSmooth ?? 1e3 },
      { id: "agile", q: opts.qAgile ?? 1e6 },
    ],
    r: opts.r ?? 1e6,
    x0: opts.x0,
    P0: opts.P0 ?? 1e4,
    transition: opts.transition || [
      [0.92, 0.08],
      [0.15, 0.85],
    ],
    mu0: opts.mu0 || [0.8, 0.2],
  });
}

export default { createImmFilter, createDelayImm };
