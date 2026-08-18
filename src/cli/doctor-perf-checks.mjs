/**
 * Doctor: flake budget + last cold-start smoke.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { evaluateFlakeBudget } from "../eval/flake-budget.mjs";

export function lastColdStartPath(cfg = {}) {
  return (
    cfg.paths?.coldStartReport ||
    path.join(cfg.paths?.configDir || path.join(os.homedir(), ".xclaw"), "cold-start.json")
  );
}

export function readLastColdStart(cfg = {}) {
  const p = lastColdStartPath(cfg);
  try {
    return { path: p, report: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return { path: p, report: null };
  }
}

export function doctorColdStartCheck(cfg = {}, report = null) {
  const maxMs = Number(cfg.ops?.coldStartMaxMs) || 5000;
  if (!report) {
    return {
      id: "ops.cold_start",
      status: "warn",
      message: `no cold-start report (run node scripts/cold-start-smoke.mjs; budget ${maxMs}ms)`,
    };
  }
  const total = Number(report.totalMs);
  if (!Number.isFinite(total)) {
    return { id: "ops.cold_start", status: "warn", message: "cold-start report missing totalMs" };
  }
  if (total > maxMs) {
    return {
      id: "ops.cold_start",
      status: "fail",
      message: `cold-start ${total}ms > budget ${maxMs}ms`,
    };
  }
  return {
    id: "ops.cold_start",
    status: "ok",
    message: `cold-start ${total}ms ≤ ${maxMs}ms (health=${report.healthStatus ?? "?"})`,
  };
}

export function readSoakFlakeCounts(cfg = {}) {
  const p = path.join(
    cfg.paths?.configDir || path.join(os.homedir(), ".xclaw"),
    "soak",
    "summary.json"
  );
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      path: p,
      totalCases: Number(s.totalCases || s.cases || 0),
      flakeCount: Number(s.flakes || s.flakeCount || 0),
    };
  } catch {
    return { path: p, totalCases: 0, flakeCount: 0, missing: true };
  }
}

export function doctorFlakeBudgetCheck(cfg = {}, counts = null) {
  const c = counts || readSoakFlakeCounts(cfg);
  if (c.missing && !c.totalCases) {
    return {
      id: "eval.flake_budget",
      status: "warn",
      message: "no soak flake summary yet (ok for fresh install)",
    };
  }
  const v = evaluateFlakeBudget(
    { totalCases: c.totalCases, flakeCount: c.flakeCount },
    cfg
  );
  return {
    id: "eval.flake_budget",
    status: v.ok ? "ok" : "fail",
    message: v.ok
      ? `flake budget ok rate=${v.flakeRate ?? 0} flakes=${v.flakeCount}/${v.totalCases}`
      : v.reason,
  };
}

export function pushPerfChecks(push, cfg = {}) {
  const flake = doctorFlakeBudgetCheck(cfg);
  push(flake.id, flake.status, flake.message);
  const { report } = readLastColdStart(cfg);
  const cold = doctorColdStartCheck(cfg, report);
  push(cold.id, cold.status, cold.message);
}

export default {
  lastColdStartPath,
  readLastColdStart,
  doctorColdStartCheck,
  doctorFlakeBudgetCheck,
  pushPerfChecks,
};
