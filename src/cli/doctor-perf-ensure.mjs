import { pushPerfChecks, lastColdStartPath } from "./doctor-perf-checks.mjs";

export async function pushPerfChecksEnsured(push, cfg = {}) {
  if (cfg.ops?.ensureColdStart !== false) {
    try {
      const { ensureColdStartReport } = await import("../ops/ensure-cold-start.mjs");
      ensureColdStartReport(cfg, {
        runSmoke: cfg.ops?.runColdStartSmoke === true,
        probe: cfg.ops?.coldStartProbe,
      });
    } catch {
      /* doctor still reports missing */
    }
  }
  pushPerfChecks(push, cfg);
}

export async function collectDoctorPerfChecks(cfg = {}) {
  const checks = [];
  await pushPerfChecksEnsured(
    (id, status, message) => checks.push({ id, status, message }),
    cfg
  );
  return { checks, coldStart: checks.find((c) => c.id === "ops.cold_start") || null };
}

export { lastColdStartPath };
export default { pushPerfChecksEnsured, collectDoctorPerfChecks };
