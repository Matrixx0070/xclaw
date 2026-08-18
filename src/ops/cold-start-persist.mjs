/**
 * Persist last cold-start smoke report for doctor / release-gate.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function coldStartReportPath(cfg = {}) {
  return (
    process.env.XCLAW_COLD_START_REPORT ||
    cfg.paths?.coldStartReport ||
    path.join(cfg.paths?.configDir || path.join(os.homedir(), ".xclaw"), "cold-start.json")
  );
}

export function persistColdStartReport(report, cfg = {}) {
  const dest = coldStartReportPath(cfg);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const payload = {
    ...report,
    at: new Date().toISOString(),
  };
  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, dest);
  return { path: dest, report: payload };
}

export default { coldStartReportPath, persistColdStartReport };
