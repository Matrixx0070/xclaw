/**
 * Dynamic weight tuning for size-weighted tool LRU.
 *
 * Strategy: pressure_skew composite
 *   - base wSize from size-distribution skew (P95 / median)
 *   - boost when transcript is over char budget (pressure)
 *   - optional feedback from last eviction freePct
 *   - EMA smoothing: single or dual-timescale (fast + slow)
 */

/**
 * Percentile of a numeric array (nearest-rank).
 */
export function percentile(values, p) {
  if (!values?.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[rank];
}

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Compute raw weights from pressure + skew (+ optional feedback).
 */
export function tuneWeightsPressureSkew(input = {}) {
  const cfg = input.cfg || {};
  const wSizeMin = cfg.wSizeMin ?? 0.25;
  const wSizeMax = cfg.wSizeMax ?? 0.9;
  const totalChars = Number(input.totalChars) || 0;
  const maxChars = Math.max(1, Number(input.maxChars) || 120_000);
  const sizes = (input.sizes || []).filter((n) => Number.isFinite(n) && n >= 0);

  const pressure = totalChars / maxChars;
  const median = percentile(sizes, 50) || 1;
  const p95 = percentile(sizes, 95) || median;
  const skew = p95 / median;

  let wSize;
  if (skew > 6) wSize = 0.75;
  else if (skew > 3) wSize = 0.65;
  else if (skew > 2) wSize = 0.55;
  else wSize = 0.5;

  if (pressure > 1.0) {
    wSize = Math.min(wSizeMax, wSize + 0.15);
  } else if (pressure > 0.85) {
    wSize = Math.min(wSizeMax, wSize + 0.08);
  } else if (pressure < 0.5 && skew <= 2) {
    wSize = Math.max(wSizeMin, wSize - 0.05);
  }

  const last = input.lastReport;
  if (last && typeof last.freePct === "number" && last.freePct < 25 && (last.truncated || 0) > 0) {
    wSize = Math.min(wSizeMax, wSize + 0.1);
  }
  if (last && (last.stubbed || 0) > (last.truncated || 0) && (last.stubbed || 0) > 2) {
    wSize = Math.min(wSizeMax, wSize + 0.05);
  }

  wSize = clamp(wSize, wSizeMin, wSizeMax);
  return {
    wAge: 1 - wSize,
    wSize,
    pressure: Number(pressure.toFixed(4)),
    skew: Number(skew.toFixed(4)),
    median,
    p95,
    strategy: "pressure_skew",
  };
}

/**
 * Dual-timescale EMA blend.
 *
 * wFast tracks raw with αFast (responsive)
 * wSlow tracks raw with αSlow (stable)
 *
 * Modes:
 *  - "blend" (default): w = β·wFast + (1-β)·wSlow
 *      β rises when |wFast−wSlow| > deadband (trend detected)
 *  - "switch": use wFast when divergence persists, else wSlow
 *  - "fixed_blend": constant β
 *
 * @param {object} state  { wFast, wSlow, divergeStreak }
 * @param {number} raw
 * @param {object} opts
 */
/**
 * Stress-adaptive dual gates.
 *
 * When context pressure is sustained over budget, relax deadband / raise αFast
 * so the fast EMA can engage. When calm, keep conservative gates for rank stability.
 *
 * @param {number} pressure  totalChars / maxChars
 * @param {number} streak    prior consecutive stress turns
 * @param {object} dualCfg   dual config including optional adaptive block
 */
export function resolveStressGates(pressure, streak = 0, dualCfg = {}) {
  const base = {
    deadband: dualCfg.deadband ?? 0.05,
    alphaFast: dualCfg.alphaFast ?? 0.5,
    alphaSlow: dualCfg.alphaSlow ?? 0.15,
    confirmTurns: dualCfg.confirmTurns ?? 2,
  };

  const ad = dualCfg.adaptive;
  if (!ad || ad.enabled === false) {
    return { ...base, streak: 0, stressed: false, nearStress: false };
  }

  const stressPressure = ad.stressPressure ?? 1.05;
  const nearPressure = ad.nearPressure ?? 0.95;
  const stressAfter = ad.stressAfter ?? 2;

  let s = pressure > stressPressure ? (streak + 1) : 0;

  if (pressure > stressPressure && s >= stressAfter) {
    return {
      deadband: ad.stressDeadband ?? 0.02,
      alphaFast: ad.stressAlphaFast ?? 0.7,
      alphaSlow: base.alphaSlow,
      confirmTurns: ad.stressConfirmTurns ?? 1,
      streak: s,
      stressed: true,
      nearStress: false,
    };
  }

  if (pressure > nearPressure) {
    return {
      deadband: ad.nearDeadband ?? 0.03,
      alphaFast: ad.nearAlphaFast ?? 0.55,
      alphaSlow: base.alphaSlow,
      confirmTurns: base.confirmTurns,
      streak: s,
      stressed: false,
      nearStress: true,
    };
  }

  return { ...base, streak: s, stressed: false, nearStress: false };
}

export function dualTimescaleEma(state, raw, opts = {}) {
  const αFast = opts.alphaFast ?? 0.5;
  const αSlow = opts.alphaSlow ?? 0.15;
  const deadband = opts.deadband ?? 0.05;
  const βMin = opts.betaMin ?? 0.25;
  const βMax = opts.betaMax ?? 0.85;
  const confirmTurns = opts.confirmTurns ?? 2;
  const mode = opts.mode || "blend"; // blend | switch | fixed_blend
  const fixedBeta = opts.beta ?? 0.4;
  const wSizeMin = opts.wSizeMin ?? 0.25;
  const wSizeMax = opts.wSizeMax ?? 0.9;

  let wFast = state?.wFast;
  let wSlow = state?.wSlow;
  let divergeStreak = state?.divergeStreak ?? 0;

  if (wFast == null || wSlow == null) {
    wFast = raw;
    wSlow = raw;
    divergeStreak = 0;
  } else {
    wFast = αFast * raw + (1 - αFast) * wFast;
    wSlow = αSlow * raw + (1 - αSlow) * wSlow;
  }

  wFast = clamp(wFast, wSizeMin, wSizeMax);
  wSlow = clamp(wSlow, wSizeMin, wSizeMax);

  const diverge = Math.abs(wFast - wSlow);
  if (diverge > deadband) divergeStreak += 1;
  else divergeStreak = 0;

  let beta;
  let wSize;
  let track = "slow";

  if (mode === "fixed_blend") {
    beta = fixedBeta;
    wSize = beta * wFast + (1 - beta) * wSlow;
    track = "blend";
  } else if (mode === "switch") {
    if (divergeStreak >= confirmTurns) {
      wSize = wFast;
      beta = 1;
      track = "fast";
    } else {
      wSize = wSlow;
      beta = 0;
      track = "slow";
    }
  } else {
    // blend: β increases with sustained divergence
    const t =
      divergeStreak >= confirmTurns
        ? smoothstep(Math.min(1, (diverge - deadband) / Math.max(deadband, 0.15)))
        : 0;
    beta = βMin + (βMax - βMin) * t;
    wSize = beta * wFast + (1 - beta) * wSlow;
    track = beta > 0.5 ? "fast_lean" : "slow_lean";
  }

  wSize = clamp(wSize, wSizeMin, wSizeMax);

  return {
    wSize,
    wAge: 1 - wSize,
    wFast,
    wSlow,
    beta,
    diverge,
    divergeStreak,
    track,
    mode,
    smoothed: true,
  };
}

/**
 * Stateful weight tuner (single EMA or dual-timescale).
 */
export function createWeightTuner(opts = {}) {
  const cfg = opts.cfg || {};
  const dual = opts.dual ?? cfg.dual ?? null;
  const ema = opts.ema ?? cfg.ema ?? 0.3;
  let prev = null;
  let dualState = null;
  let lastReport = null;

  function tune({ totalChars, maxChars, sizes }) {
    const raw = tuneWeightsPressureSkew({
      totalChars,
      maxChars,
      sizes,
      lastReport,
      cfg,
    });

    const dualCfg = dual && dual.enabled !== false ? dual : null;

    if (dualCfg) {
      const pressure = raw.pressure ?? (opts.totalChars / Math.max(1, opts.maxChars || 1));
      // Note: tune() closure — pressure from raw result
      const gates = resolveStressGates(
        raw.pressure,
        dualState?.stressStreak ?? 0,
        dualCfg
      );
      const d = dualTimescaleEma(dualState, raw.wSize, {
        alphaFast: gates.alphaFast,
        alphaSlow: gates.alphaSlow,
        deadband: gates.deadband,
        betaMin: dualCfg.betaMin ?? 0.25,
        betaMax: dualCfg.betaMax ?? 0.85,
        confirmTurns: gates.confirmTurns,
        mode: dualCfg.mode || "blend",
        beta: dualCfg.beta ?? 0.4,
        wSizeMin: cfg.wSizeMin ?? 0.25,
        wSizeMax: cfg.wSizeMax ?? 0.9,
      });
      dualState = {
        wFast: d.wFast,
        wSlow: d.wSlow,
        divergeStreak: d.divergeStreak,
        stressStreak: gates.streak,
      };
      prev = {
        ...raw,
        wSize: d.wSize,
        wAge: d.wAge,
        wSizeRaw: raw.wSize,
        wFast: d.wFast,
        wSlow: d.wSlow,
        beta: d.beta,
        diverge: d.diverge,
        divergeStreak: d.divergeStreak,
        track: d.track,
        deadband: gates.deadband,
        alphaFast: gates.alphaFast,
        stressed: gates.stressed,
        nearStress: gates.nearStress,
        emaMode: "dual",
        smoothed: true,
      };
      return prev;
    }

    // Single EMA path
    if (prev && ema > 0 && ema < 1) {
      const wSize = clamp(
        ema * raw.wSize + (1 - ema) * prev.wSize,
        cfg.wSizeMin ?? 0.25,
        cfg.wSizeMax ?? 0.9
      );
      prev = {
        ...raw,
        wSize,
        wAge: 1 - wSize,
        wSizeRaw: raw.wSize,
        emaMode: "single",
        smoothed: true,
      };
    } else {
      prev = {
        ...raw,
        wSizeRaw: raw.wSize,
        emaMode: "none",
        smoothed: false,
      };
    }
    return prev;
  }

  function recordReport(report) {
    if (!report) return;
    const before = report.beforeChars;
    const after = report.afterChars ?? report.totalChars;
    let freePct = report.freePct;
    if (freePct == null && before > 0 && after != null) {
      freePct = (100 * (before - after)) / before;
    }
    lastReport = {
      freePct,
      truncated: report.truncated ?? 0,
      stubbed: report.stubbed ?? 0,
      spliced: report.spliced ?? 0,
    };
  }

  function snapshot() {
    return { weights: prev, lastReport, dualState };
  }

  function reset() {
    prev = null;
    dualState = null;
    lastReport = null;
  }

  return { tune, recordReport, snapshot, reset };
}

/**
 * Resolve effective weights for a scoring pass (stateless helper + optional prev dual state).
 */
export function resolveLruWeights(opts = {}) {
  const mode = opts.mode || "size_weighted";
  if (mode !== "size_weighted") {
    return {
      wAge: opts.wAge ?? 0.35,
      wSize: opts.wSize ?? 0.65,
      dynamic: false,
    };
  }

  const dyn = opts.dynamic;
  if (!dyn || dyn.enabled === false) {
    return {
      wAge: opts.wAge ?? 0.35,
      wSize: opts.wSize ?? 0.65,
      dynamic: false,
    };
  }

  const tuned = tuneWeightsPressureSkew({
    totalChars: opts.totalChars,
    maxChars: opts.maxChars,
    sizes: opts.sizes || [],
    lastReport: opts.lastReport,
    cfg: dyn,
  });

  const dualCfg = dyn.dual && dyn.dual.enabled !== false ? dyn.dual : null;

  if (dualCfg && opts.dualState) {
    const gates = resolveStressGates(
      tuned.pressure,
      opts.dualState.stressStreak ?? 0,
      dualCfg
    );
    const d = dualTimescaleEma(opts.dualState, tuned.wSize, {
      alphaFast: gates.alphaFast,
      alphaSlow: gates.alphaSlow,
      deadband: gates.deadband,
      betaMin: dualCfg.betaMin ?? 0.25,
      betaMax: dualCfg.betaMax ?? 0.85,
      confirmTurns: gates.confirmTurns,
      mode: dualCfg.mode || "blend",
      beta: dualCfg.beta ?? 0.4,
      wSizeMin: dyn.wSizeMin ?? 0.25,
      wSizeMax: dyn.wSizeMax ?? 0.9,
    });
    return {
      ...tuned,
      wSize: d.wSize,
      wAge: d.wAge,
      wFast: d.wFast,
      wSlow: d.wSlow,
      beta: d.beta,
      diverge: d.diverge,
      divergeStreak: d.divergeStreak,
      track: d.track,
      deadband: gates.deadband,
      alphaFast: gates.alphaFast,
      stressed: gates.stressed,
      nearStress: gates.nearStress,
      dualState: {
        wFast: d.wFast,
        wSlow: d.wSlow,
        divergeStreak: d.divergeStreak,
        stressStreak: gates.streak,
      },
      dynamic: true,
      emaMode: "dual",
      smoothed: true,
    };
  }

  if (opts.prevWeights && (dyn.ema ?? 0.3) > 0 && !dualCfg) {
    const ema = dyn.ema ?? 0.3;
    const wSize = clamp(
      ema * tuned.wSize + (1 - ema) * opts.prevWeights.wSize,
      dyn.wSizeMin ?? 0.25,
      dyn.wSizeMax ?? 0.9
    );
    return {
      ...tuned,
      wSize,
      wAge: 1 - wSize,
      dynamic: true,
      emaMode: "single",
      smoothed: true,
    };
  }

  // Stateless dual init (first call)
  if (dualCfg) {
    const gates = resolveStressGates(tuned.pressure, 0, dualCfg);
    const d = dualTimescaleEma(null, tuned.wSize, {
      alphaFast: gates.alphaFast,
      alphaSlow: gates.alphaSlow,
      mode: dualCfg.mode || "blend",
      beta: dualCfg.beta ?? 0.4,
      wSizeMin: dyn.wSizeMin ?? 0.25,
      wSizeMax: dyn.wSizeMax ?? 0.9,
      deadband: gates.deadband,
      confirmTurns: gates.confirmTurns,
      betaMin: dualCfg.betaMin ?? 0.25,
      betaMax: dualCfg.betaMax ?? 0.85,
    });
    return {
      ...tuned,
      wSize: d.wSize,
      wAge: d.wAge,
      wFast: d.wFast,
      wSlow: d.wSlow,
      beta: d.beta,
      track: d.track,
      deadband: gates.deadband,
      alphaFast: gates.alphaFast,
      stressed: gates.stressed,
      nearStress: gates.nearStress,
      dualState: {
        wFast: d.wFast,
        wSlow: d.wSlow,
        divergeStreak: d.divergeStreak,
        stressStreak: gates.streak,
      },
      dynamic: true,
      emaMode: "dual",
      smoothed: true,
    };
  }

  return { ...tuned, dynamic: true, emaMode: "none", smoothed: false };
}
