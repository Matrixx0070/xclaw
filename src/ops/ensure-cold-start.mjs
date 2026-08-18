/**
 * Ensure a last cold-start report exists for doctor / release-gate --strict.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLastColdStart } from "../cli/doctor-perf-checks.mjs";
import { persistColdStartReport } from "./cold-start-persist.mjs";

export function ensureColdStartReport(cfg = {}, opts = {}) {
  const existing = readLastColdStart(cfg);
  if (existing.report) {
    return { wrote: false, reason: "exists", ...existing };
  }

  if (typeof opts.probe === "function") {
    const report = opts.probe(cfg);
    if (report) {
      const saved = persistColdStartReport(report, cfg);
      return { wrote: true, reason: "probe", path: saved.path, report: saved.report };
    }
  }

  if (opts.runSmoke !== false && process.env.XCLAW_ENSURE_COLD_START !== "0") {
    const root =
      opts.root ||
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const smoke = path.join(root, "scripts", "cold-start-smoke.mjs");
    const r = spawnSync(process.execPath, [smoke], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, XCLAW_COLD_START_REPORT: existing.path },
      timeout: opts.timeoutMs ?? 20_000,
    });
    const after = readLastColdStart(cfg);
    if (after.report) {
      return { wrote: true, reason: "smoke", path: after.path, report: after.report, code: r.status };
    }
    return {
      wrote: false,
      reason: "smoke_failed",
      path: existing.path,
      report: null,
      code: r.status,
      stderr: (r.stderr || "").slice(0, 400),
    };
  }

  return { wrote: false, reason: "missing", path: existing.path, report: null };
}

export default { ensureColdStartReport };
