/**
 * Verdict for one live-enforcement-e2e run.
 *
 * Split out of live-e2e-job.mjs because the grade was three expressions
 * interleaved with a spawn, a JSON.parse and an alerter call — untestable
 * without a subprocess, and so never tested. Two defects lived in it:
 *
 * 1. The child's exit code was read as `code ?? 1`. Node delivers
 *    `code === null, signal === "SIGKILL"` when a child dies on a signal, so
 *    an OOM-killed or SIGTERM'd suite scored 1 — which this grader's
 *    non-strict mode treats as "warnings only, soft pass". A run that never
 *    finished reported the same verdict as a run that finished with warnings.
 *
 * 2. The soft-pass override was `report.ok !== false || code === 1`, and the
 *    `code === 1` half applied even when stdout could not be parsed at all.
 *    A missing or moved scripts/live-enforcement-e2e.mjs makes node exit 1
 *    with empty stdout; the parse fails, the fallback fabricates
 *    `{ ok: false }`, and the override then flips it back to a pass.
 *    Measured before the fix: `report.ok=false hardFail=false ok=true` —
 *    green forever, having run zero checks.
 *
 * The producer decides both signals from one variable
 * (live-enforcement-e2e.mjs:276-283: `code = fails ? 2 : warns ? 1 : 0` and
 * `ok: fails === 0`), so from a real report `ok === false` implies exit 2.
 * The `code === 1` override is therefore only ever consulted for a report
 * this process invented — which is exactly the case it must not rescue.
 */

/**
 * Exit code substituted when the child died on a signal rather than exiting.
 *
 * Must be >= 3: the producer owns 0/1/2, and negative sentinels would land in
 * the soft-pass band of the non-strict rule below.
 */
export const CODE_SIGNAL = 4;

/**
 * @param {{code: number, reportOk?: boolean, parsed?: boolean, strict?: boolean}} input
 *   code     exit code, with CODE_SIGNAL substituted for signal death
 *   reportOk the `ok` field of the parsed report, or of the fabricated fallback
 *   parsed   whether stdout actually yielded a report object
 *   strict   any non-zero exit is a hard failure
 * @returns {{ok: boolean, hardFail: boolean, reason: string}}
 */
export function gradeLiveE2e({ code, reportOk, parsed = false, strict = false }) {
  const hardFail = strict ? code !== 0 : code === 2 || code > 2;
  if (hardFail) {
    return { ok: false, hardFail: true, reason: code === CODE_SIGNAL ? "signal" : "hard-fail" };
  }
  if (reportOk !== false) return { ok: true, hardFail: false, reason: "ok" };
  // exit 1 = warnings only → soft ok for cadence, but only when the report
  // saying so was actually read off the child rather than invented here.
  if (parsed && code === 1) return { ok: true, hardFail: false, reason: "warnings" };
  return { ok: false, hardFail: false, reason: parsed ? "report-fail" : "unparseable" };
}

export default { gradeLiveE2e, CODE_SIGNAL };
