/**
 * Doctor: last-smoke vs prev-smoke.
 *
 * `missing_current` was a warn, which asks the operator to act on a state they
 * cannot leave: nothing in production writes reports/autonomy/last-smoke.json.
 * Its only writer is scripts/autonomy-smoke-offline.mjs, invoked from the ship
 * pack — no workflow, no scheduler, no gateway path calls it — so the artifact
 * never exists outside a build checkout and this row warned forever, on every
 * host, saying exactly what it would say if the smoke had run and passed.
 *
 * Absence is reported at info, and the message names the artifact and the
 * command that produces it. Should the smoke ever be put on a schedule, "the
 * scheduled thing did not run" is ops.schedule's question, not this one's —
 * that separation is what keeps a missing artifact from masking a dead job.
 */
import { compareAutonomySmoke } from "../eval/autonomy-smoke-compare.mjs";
import { smokeArtifactPath } from "../eval/autonomy-smoke-artifact.mjs";

export function pushSmokeCompareChecks(push, root = process.cwd()) {
  const c = compareAutonomySmoke(root);
  if (c.reason === "missing_current") {
    push(
      "ops.smoke_compare",
      "info",
      `no autonomy smoke artifact (${smokeArtifactPath(root)}) — run: node scripts/autonomy-smoke-offline.mjs`,
      { reason: c.reason, ok: c.ok, first: Boolean(c.first), noData: true }
    );
    return c;
  }
  const status = c.reason === "regressed" ? "error" : c.ok ? "ok" : "warn";
  push("ops.smoke_compare", status, `autonomy smoke ${c.reason}${c.first ? " (first run)" : ""}`, {
    reason: c.reason,
    ok: c.ok,
    first: Boolean(c.first),
  });
  return c;
}

export default { pushSmokeCompareChecks };
