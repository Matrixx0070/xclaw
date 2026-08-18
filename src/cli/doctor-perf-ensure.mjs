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

export { lastColdStartPath };
export default { pushPerfChecksEnsured };
