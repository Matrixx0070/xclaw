/**
 * Multi-trial soak runner for autonomy cases.
 */
import { runAutonomyHarness } from "./autonomy-harness.mjs";

export async function runAutonomySoak(opts = {}) {
  const trials = Math.max(1, Number(opts.trials) || 3);
  const runs = [];
  for (let i = 0; i < trials; i++) {
    const r = await runAutonomyHarness({ ...opts, offline: opts.offline !== false });
    runs.push(r);
  }
  const okCount = runs.filter((r) => r.ok).length;
  const flakeRate = 1 - okCount / trials;
  const maxFlake = Number(opts.maxFlakeRate ?? 0.34);
  return {
    ok: flakeRate <= maxFlake,
    trials,
    okCount,
    flakeRate,
    maxFlake,
    runs,
    at: new Date().toISOString(),
  };
}

export default { runAutonomySoak };
