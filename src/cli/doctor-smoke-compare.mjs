/**
 * Doctor: last-smoke vs prev-smoke.
 */
import { compareAutonomySmoke } from "../eval/autonomy-smoke-compare.mjs";

export function pushSmokeCompareChecks(push, root = process.cwd()) {
  const c = compareAutonomySmoke(root);
  const status =
    c.reason === "regressed" ? "error" : c.reason === "missing_current" ? "warn" : c.ok ? "ok" : "warn";
  push(
    "ops.smoke_compare",
    status,
    `autonomy smoke ${c.reason}${c.first ? " (first run)" : ""}`,
    { reason: c.reason, ok: c.ok, first: Boolean(c.first) }
  );
  return c;
}

export default { pushSmokeCompareChecks };
