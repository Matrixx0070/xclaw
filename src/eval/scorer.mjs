/**
 * Eval scorers (verify + budgets + grounding + reply text).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { runVerifyChecks } from "../jobs/verify.mjs";
import { scoreCausal, loadTimeline } from "../browser/timetravel.mjs";

/** Whitespace-insensitive form for code-ish comparisons ("a + b" ≡ "a+b"). */
function normalizeLoose(s) {
  return String(s || "").replace(/\s+/g, "");
}

export async function scoreCase(caseDef, jobResult) {
  const failures = [];
  const workspace = jobResult.workspace;

  const successChecks = caseDef.expect?.success || caseDef.verify || [];
  const verify = jobResult.verify || (await runVerifyChecks(workspace, successChecks));

  if (successChecks.length && !verify.ok) {
    for (const r of verify.results.filter((x) => !x.pass)) {
      failures.push(`verify:${r.type}:${r.path || r.cmd || ""} ${r.detail || ""}`.trim());
    }
  }

  const failIf = caseDef.expect?.failIf || [];
  for (const f of failIf) {
    if (f.type === "guard_critical") {
      const hit = (jobResult.events || []).some((e) => e.type === "guard" && e.level === "critical");
      if (hit) failures.push("guard_critical");
    }
  }

  const budgets = caseDef.expect?.budgets || {};
  let budgetsOk = true;
  if (budgets.maxTurns != null && jobResult.turns > budgets.maxTurns) {
    budgetsOk = false;
    failures.push(`budget:maxTurns ${jobResult.turns}>${budgets.maxTurns}`);
  }
  if (budgets.maxToolCalls != null && jobResult.toolCalls > budgets.maxToolCalls) {
    budgetsOk = false;
    failures.push(`budget:maxToolCalls ${jobResult.toolCalls}>${budgets.maxToolCalls}`);
  }

  const forbid = caseDef.expect?.forbidFiles || [];
  for (const fp of forbid) {
    const check = await runVerifyChecks(workspace, [{ type: "file_not_exists", path: fp }]);
    if (!check.ok) failures.push(`forbid_file:${fp}`);
  }

  // Formatting-robust any-of checks. Surface-form literals (file_contains /
  // replyContains) are brittle both ways: a correct answer phrased differently
  // fails, and they invite teaching-to-the-test. These match whitespace-
  // normalized, so "a + b" ≡ "a+b" ≡ "a  +  b" — but "a - b" still fails.
  for (const check of caseDef.expect?.fileContainsAny || []) {
    const anyOf = (check.anyOf || []).map(normalizeLoose).filter(Boolean);
    if (!check.path || !anyOf.length) {
      failures.push(`fileContainsAny:invalid:${check.path || "?"}`);
      continue;
    }
    let body = null;
    try {
      body = normalizeLoose(await fs.readFile(path.join(workspace, check.path), "utf8"));
    } catch {
      failures.push(`fileContainsAny:missing:${check.path}`);
      continue;
    }
    if (!anyOf.some((n) => body.includes(n))) {
      failures.push(`fileContainsAny:${check.path}:${check.anyOf.join("|")}`);
    }
  }

  const reply = String(jobResult.text || "");
  for (const needle of caseDef.expect?.replyContains || []) {
    if (!reply.includes(needle)) {
      failures.push(`replyContains:${needle}`);
    }
  }
  for (const group of caseDef.expect?.replyContainsAny || []) {
    const anyOf = (Array.isArray(group) ? group : [group]).map(normalizeLoose).filter(Boolean);
    if (anyOf.length && !anyOf.some((n) => normalizeLoose(reply).includes(n))) {
      failures.push(`replyContainsAny:${(Array.isArray(group) ? group : [group]).join("|")}`);
    }
  }
  for (const needle of caseDef.expect?.replyNotContains || []) {
    if (reply.toLowerCase().includes(String(needle).toLowerCase())) {
      failures.push(`replyNotContains:${needle}`);
    }
  }

  if (caseDef.groundHard || caseDef.expect?.requireEvidence || caseDef.expect?.claimsRequireEvidence) {
    if (jobResult.groundingFailed) {
      failures.push("grounding:hard_fail");
    }
    for (const w of jobResult.groundingWarnings || []) {
      if (caseDef.groundHard || caseDef.expect?.claimsRequireEvidence) failures.push(`grounding:${w}`);
    }
    if (
      jobResult.claimScore &&
      !jobResult.claimScore.ok &&
      (caseDef.expect?.claimsRequireEvidence || caseDef.expect?.requireStructuredClaims)
    ) {
      for (const w of jobResult.claimScore.warnings || []) failures.push(`claim:${w}`);
    }
  }

  // Horizon 5: causal correctness from network/action traces
  let causal = null;
  const causalExpect = caseDef.expect?.causal || caseDef.expect?.network
    ? {
        network: caseDef.expect?.network || caseDef.expect?.causal?.network,
        actions: caseDef.expect?.causal?.actions || caseDef.expect?.actions,
        requireBindings: caseDef.expect?.causal?.requireBindings,
        minFlows: caseDef.expect?.causal?.minFlows ?? caseDef.expect?.minFlows,
        maxFlows: caseDef.expect?.causal?.maxFlows,
        forbidHosts: caseDef.expect?.causal?.forbidHosts || caseDef.expect?.forbidHosts,
        ...(typeof caseDef.expect?.causal === "object" ? caseDef.expect.causal : {}),
      }
    : null;
  if (causalExpect && (causalExpect.network || causalExpect.actions || causalExpect.minFlows != null || causalExpect.forbidHosts)) {
    try {
      const timeline = jobResult.timeline || (await loadTimeline({
        confdir: jobResult.mitmConfdir,
        limit: 500,
      }));
      causal = scoreCausal(causalExpect, timeline);
      if (!causal.pass) {
        for (const f of causal.failures) failures.push(`causal:${f}`);
      }
    } catch (e) {
      failures.push(`causal:error:${e?.message || e}`);
      causal = { pass: false, failures: [String(e?.message || e)] };
    }
  }

  const pass =
    failures.length === 0 &&
    (successChecks.length ? verify.ok : true);

  return {
    id: caseDef.id,
    pass,
    failures,
    budgetsOk,
    verify,
    causal,
    turns: jobResult.turns,
    toolCalls: jobResult.toolCalls,
    toolErrors: jobResult.toolErrors,
    wallMs: jobResult.wallMs,
    status: jobResult.status,
  };
}
