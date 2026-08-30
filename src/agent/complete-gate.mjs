/**
 * Evidence-based completion for the default agent loop.
 *
 * Jobs and objectives already refuse a model "done" without checks.
 * The default loop treated a tool-free assistant reply as completion
 * (stopReason "natural"). That is correct for chat ("what is 2+2?") and
 * wrong for a verifiable task ("Create /tmp/hello.txt with text ok").
 *
 * This gate derives conservative file checks from the user goal (or uses
 * an explicit verify[]), runs jobs/verify.mjs, and REJECTS a natural stop
 * while they fail. Chat without a derivable check is unchanged.
 */
import { runVerifyChecks } from "../jobs/verify.mjs";
import { inferGoal } from "./turn-state.mjs";

const PATH = "(?:\\/|\\.\\/)?[\\w./-]+\\.[A-Za-z0-9]+";

/**
 * Conservative: only when the goal names a path AND the expected contents.
 * Questions and open-ended chat return [].
 *
 * @param {string} goal
 * @returns {object[]}
 */
export function deriveGoalVerifyChecks(goal = "") {
  const u = String(goal || "").trim();
  if (!u) return [];
  const g = inferGoal(u);
  if (g.question && !g.action) return [];

  const createWith = u.match(
    new RegExp(
      `\\b(?:create|write)\\s+[\`'"]?(${PATH})[\`'"]?\\s+(?:with(?:\\s+text)?|containing)\\s+[\`'"]?(.+?)[\`'"]?\\s*$`,
      "i"
    )
  );
  if (createWith) {
    return [{ type: "file_contains", path: createWith[1], text: createWith[2].trim() }];
  }
  const writeTo = u.match(
    new RegExp(
      `\\bwrite\\s+[\`'"](.+?)[\`'"]\\s+to\\s+[\`'"]?(${PATH})`,
      "i"
    )
  );
  if (writeTo) {
    return [{ type: "file_contains", path: writeTo[2], text: writeTo[1] }];
  }
  return [];
}

/**
 * @param {{ verify?: object[], userMessage?: string }} opts
 * @returns {object[]}
 */
export function resolveCompletionChecks(opts = {}) {
  if (Array.isArray(opts.verify) && opts.verify.length) return opts.verify;
  return deriveGoalVerifyChecks(opts.userMessage || "");
}

function formatRejectNotice(result) {
  const failed = (result.results || []).filter((r) => !r.pass);
  const lines = failed.map((r) => {
    const where = r.path || r.cmd || "";
    const detail = r.detail ? ` (${r.detail})` : "";
    return `- ${r.type}${where ? " " + where : ""}${detail}`;
  });
  return (
    "Completion rejected: the success checks are not satisfied:\n" +
    (lines.join("\n") || "- (unknown check failed)") +
    "\nThe task is NOT done. Use tools to satisfy the checks. Do not claim done until they pass."
  );
}

/**
 * @param {object} inp
 * @param {boolean} inp.naturalStop
 * @param {object} [inp.cfg]
 * @param {string} [inp.workingDir]
 * @param {string} [inp.userMessage]
 * @param {object[]} [inp.verify]
 * @returns {Promise<{ reject: boolean, checks: object[], result?: object, notice?: string }>}
 */
export async function evaluateNaturalStopVerify(inp = {}) {
  if (!inp.naturalStop) return { reject: false, checks: [] };
  if (inp.cfg?.agent?.verifyOnComplete === false) return { reject: false, checks: [] };
  const checks = resolveCompletionChecks(inp);
  if (!checks.length) return { reject: false, checks: [] };
  const workspace = inp.workingDir || process.cwd();
  const result = await runVerifyChecks(workspace, checks);
  if (result.ok) return { reject: false, checks, result };
  return {
    reject: true,
    checks,
    result,
    notice: formatRejectNotice(result),
  };
}

export default {
  deriveGoalVerifyChecks,
  resolveCompletionChecks,
  evaluateNaturalStopVerify,
};
