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

export async function mergePerfIntoChecks(checks, cfg = {}) {
  const { checks: perf } = await collectDoctorPerfChecks(cfg);
  const ids = new Set((checks || []).map((c) => c.id));
  for (const c of perf) {
    if (!ids.has(c.id)) {
      checks.push(c);
      ids.add(c.id);
    }
  }
  return checks;
}

export { lastColdStartPath };
export default { pushPerfChecksEnsured, collectDoctorPerfChecks, mergePerfIntoChecks };
