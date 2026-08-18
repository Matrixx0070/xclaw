/**
 * release-gate:strict extras — flake budget + cold-start must pass.
 */
import { evaluateFlakeBudget } from "./flake-budget.mjs";
import {
  doctorColdStartCheck,
  doctorFlakeBudgetCheck,
} from "../cli/doctor-perf-checks.mjs";

export function evaluateReleaseGateStrict(input = {}) {
  const cfg = input.cfg || {};
  const flake =
    input.flake != null
      ? evaluateFlakeBudget(input.flake, cfg)
      : { ok: true, skipped: true, reason: null };
  const flakeDoctor = doctorFlakeBudgetCheck(cfg, input.flake || { missing: true });
  const cold = doctorColdStartCheck(cfg, input.coldStart || null);

  const checks = [
    {
      name: "flake_budget",
      ok: flake.ok !== false && flakeDoctor.status !== "fail",
      required: true,
      detail: flake.reason || flakeDoctor.message,
    },
    {
      name: "cold_start",
      ok: cold.status !== "fail",
      required: Boolean(input.coldStart) || cfg.ops?.requireColdStart === true,
      detail: cold.message,
    },
  ];
  const failed = checks.filter((c) => c.required && !c.ok);
  return {
    ok: failed.length === 0,
    strict: true,
    checks,
    failed: failed.map((c) => c.name),
  };
}

export default { evaluateReleaseGateStrict };
