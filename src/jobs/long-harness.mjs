/**
 * Long-running agent harness — hard grounding, verify-by-default, anti-hallucination.
 *
 * Defaults (override via opts / cfg.harness):
 *   - groundHard: true
 *   - claimsRequireEvidence: true
 *   - requireStructuredClaims: true
 *   - maxTurns: 24 (or cfg.agent.maxTurns if higher)
 *   - timeoutMs: 300_000
 *   - persistRun: true
 *   - groundingRetry: 1 (one corrective re-run if grounding fails and verify still empty/failed)
 *
 * Fail closed on ungrounded claims: job.pass === false with groundingFailed.
 */

import path from "node:path";
import os from "node:os";
import { runJob } from "./job.mjs";

export const HARNESS_SYSTEM_NOTES = `
## Long-run harness (anti-hallucination)

You are in a verified long-running job. Strict rules:

1. NEVER invent file contents, paths, command output, URLs, or tool results.
2. After every write/create, re-read or list to confirm before claiming success.
3. If a path is missing, say so and stop inventing — report MISSING or failure clearly.
4. End with a structured claims block only for actions you actually performed:
\`\`\`json
{"claims":["created docs/intro.md with heading # Intro"],"evidence_ids":["write_file","bash"]}
\`\`\`
5. Prefer the minimal tool sequence that satisfies verify checks.
6. Do not claim tests passed unless you ran the test command and saw the result.
`.trim();

/**
 * @param {object} opts — same as runJob, plus harness flags
 * @param {string} opts.goal
 * @param {object} opts.cfg
 * @param {object[]} [opts.verify]
 * @param {boolean} [opts.groundHard=true]
 * @param {boolean} [opts.claimsRequireEvidence=true]
 * @param {boolean} [opts.requireStructuredClaims=true]
 * @param {number} [opts.groundingRetry=1]
 * @param {number} [opts.maxTurns]
 * @param {number} [opts.timeoutMs]
 */
export async function runLongHarness(opts) {
  const cfg = opts.cfg || {};
  const h = cfg.harness || {};
  const maxTurns =
    opts.maxTurns ??
    h.maxTurns ??
    Math.max(Number(cfg.agent?.maxTurns) || 0, 24);
  const timeoutMs = opts.timeoutMs ?? h.timeoutMs ?? 300_000;
  const groundHard = opts.groundHard ?? h.groundHard ?? true;
  const claimsRequireEvidence =
    opts.claimsRequireEvidence ?? h.claimsRequireEvidence ?? true;
  const requireStructuredClaims =
    opts.requireStructuredClaims ?? h.requireStructuredClaims ?? true;
  const groundingRetry =
    opts.groundingRetry ?? h.groundingRetry ?? 1;
  const persistRun = opts.persistRun ?? h.persistRun ?? true;
  const checkpointEveryTurns =
    opts.checkpointEveryTurns ?? h.checkpointEveryTurns ?? 3;

  const workspace =
    opts.workspace ||
    path.join(os.tmpdir(), "xclaw-harness", `h_${Date.now().toString(36)}`);

  const systemNotes = [
    HARNESS_SYSTEM_NOTES,
    ...(opts.systemNotes
      ? Array.isArray(opts.systemNotes)
        ? opts.systemNotes
        : [opts.systemNotes]
      : []),
  ];

  const base = {
    ...opts,
    cfg: {
      ...cfg,
      agent: {
        ...(cfg.agent || {}),
        maxTurns,
        systemNotes,
      },
      jobs: {
        ...(cfg.jobs || {}),
        groundHard: true,
      },
    },
    workspace,
    maxTurns,
    timeoutMs,
    groundHard,
    claimsRequireEvidence,
    requireStructuredClaims,
    systemNotes,
    persistRun,
    checkpointEveryTurns,
    sessionId: opts.sessionId || opts.id,
  };

  const onEvent = opts.onEvent || (() => {});
  onEvent({
    type: "harness",
    phase: "start",
    groundHard,
    claimsRequireEvidence,
    requireStructuredClaims,
    maxTurns,
    timeoutMs,
    workspace,
  });

  let job = await runJob(base);

  // One corrective attempt if grounding failed (hallucinated claims) but we still have budget
  let attempts = 1;
  while (
    job.groundingFailed &&
    attempts <= groundingRetry &&
    !job.costBlocked
  ) {
    attempts += 1;
    onEvent({
      type: "harness",
      phase: "grounding_retry",
      attempt: attempts,
      warnings: job.groundingWarnings || [],
    });
    const critique = [
      "Previous attempt failed HARD GROUNDING checks. Do not repeat invented claims.",
      "Warnings:",
      ...(job.groundingWarnings || []).slice(0, 12).map((w) => `- ${w}`),
      "",
      "Re-do the goal. Use tools only. Re-read after writes. End with a valid structured claims block citing real tool evidence.",
      "",
      `Original goal:\n${opts.goal}`,
    ].join("\n");

    job = await runJob({
      ...base,
      id: `${job.id}_r${attempts}`,
      goal: critique,
      // keep same workspace so prior files exist
      workspace: job.workspace || workspace,
    });
  }

  job.harness = {
    mode: "long",
    attempts,
    groundHard,
    claimsRequireEvidence,
    requireStructuredClaims,
  };

  onEvent({
    type: "harness",
    phase: "end",
    pass: job.pass,
    status: job.status,
    groundingFailed: job.groundingFailed,
    attempts,
  });

  return job;
}

/**
 * Default verify checks for a simple write+confirm smoke (optional helper).
 */
export function defaultHarnessVerify(relPath, contains) {
  const checks = [
    { type: "file_exists", path: relPath },
  ];
  if (contains != null) {
    checks.push({ type: "file_contains", path: relPath, text: String(contains) });
  }
  return checks;
}

export default { runLongHarness, HARNESS_SYSTEM_NOTES, defaultHarnessVerify };
