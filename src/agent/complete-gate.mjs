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
// Optional "a/the file named/called" between the verb and the path so
// "write a file hello.txt" matches the same way "write hello.txt" does.
const FILE_PREFIX = "(?:(?:a|the)\\s+)?(?:file\\s+)?(?:(?:named|called)\\s+)?";
const CONTENT =
  "(?:with(?:\\s+text|\\s+contents)?|containing|that says|whose first line is)";
const CHAT_LEAD =
  /^(what|why|how|when|where|who|explain|describe|list|tell|summarize|thanks)\b/i;
const FILE_VERB = /^(create|write|save|put|touch|make)\b/i;

function stripWrap(s) {
  return String(s || "")
    .trim()
    .replace(/^[\`'"]+|[\`'"]+$/g, "")
    .replace(/[.,;]+$/g, "")
    .trim();
}

/** Drop "exactly:" and trailing "Then stop." / "When done" task closers. */
function cleanExpectedText(s) {
  let t = stripWrap(s);
  t = t.replace(/^exactly:?\s+/i, "");
  const nl = t.search(/\r?\n/);
  if (nl >= 0) {
    const rest = t.slice(nl).trim();
    if (/^(then stop|when done|do not\b|stop\.?$)/i.test(rest)) {
      t = t.slice(0, nl);
    }
  }
  t = t.replace(/\s+(?:then stop\.?|when done[,.]?.*)$/i, "");
  return stripWrap(t);
}

function isChat(u, g) {
  if (g.question && !g.action) return true;
  if (CHAT_LEAD.test(u) && !FILE_VERB.test(u)) return true;
  return false;
}

/**
 * Derive checks from a goal that names a file.
 *
 * file_contains when the goal names both a path and the expected text.
 * file_exists when it names a path to create/write/save/touch/make/put
 * but not the contents (the file still has to appear).
 *
 * Chat, questions, and "how do I write a file" stay empty.
 *
 * @param {string} goal
 * @returns {object[]}
 */
export function deriveGoalVerifyChecks(goal = "") {
  const u = String(goal || "").trim();
  if (!u) return [];
  const g = inferGoal(u);
  if (isChat(u, g)) return [];

  const createWith = u.match(
    new RegExp(
      `\\b(?:create|write|save|put|make)\\s+${FILE_PREFIX}[\`'"]?(${PATH})[\`'"]?\\s+${CONTENT}\\s+(?:exactly:?\\s*)?[\`'"]?([\\s\\S]+?)[\`'"]?\\s*$`,
      "i"
    )
  );
  if (createWith) {
    const text = cleanExpectedText(createWith[2]);
    if (text) return [{ type: "file_contains", path: createWith[1], text }];
  }

  const writeTo = u.match(
    new RegExp(
      `\\b(?:write|put|save)\\s+[\`'"]?([^\\s'\`"]+|[^'"\`]+?)[\`'"]?\\s+(?:to|into|in)\\s+[\`'"]?(${PATH})`,
      "i"
    )
  );
  if (writeTo) {
    const text = stripWrap(writeTo[1]);
    if (text && !/\s/.test(text)) {
      return [{ type: "file_contains", path: writeTo[2], text }];
    }
    if (text) return [{ type: "file_contains", path: writeTo[2], text }];
  }

  const createOnly = u.match(
    new RegExp(
      `\\b(?:create|write|save|touch|make|put)\\s+${FILE_PREFIX}[\`'"]?(${PATH})[\`'"]?(?:\\s|$)`,
      "i"
    )
  );
  if (createOnly) {
    return [{ type: "file_exists", path: createOnly[1] }];
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

/**
 * CLI / script exit: unverified and runtime cutoffs are not success.
 * Chat that finished naturally stays 0.
 */
export function agentExitCode(result = {}) {
  if (result.ok === false) return 1;
  const sr = String(result.stopReason || "");
  if (
    sr === "unverified" ||
    sr === "aborted" ||
    sr === "guard" ||
    sr === "policy" ||
    sr === "budget" ||
    sr === "maxTurns"
  ) {
    return 1;
  }
  if (result.status === "failed" || result.status === "blocked") return 1;
  return 0;
}

export default {
  deriveGoalVerifyChecks,
  resolveCompletionChecks,
  evaluateNaturalStopVerify,
  agentExitCode,
};
