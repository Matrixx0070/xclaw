/**
 * Skill learning closed loop + A/B harness (Phase L).
 * fail → propose → install → re-run same case → record delta.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { proposeSkillFromFailure, installProposal } from "./propose.mjs";
import { loadCases, runEvalSuite } from "../eval/runner.mjs";

function metricsPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "skill-loop-metrics.jsonl");
}

export async function recordSkillLoopMetric(cfg, row) {
  const fp = metricsPath(cfg);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.appendFile(
    fp,
    JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"
  );
  return fp;
}

export async function readSkillLoopMetrics(cfg, limit = 50) {
  try {
    const raw = await fs.readFile(metricsPath(cfg), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

export function computeSkillDelta(before, after) {
  const bTurns = before?.turns ?? before?.meanTurns ?? null;
  const aTurns = after?.turns ?? after?.meanTurns ?? null;
  const bPass = Boolean(before?.pass ?? (before?.passRate === 1));
  const aPass = Boolean(after?.pass ?? (after?.passRate === 1));
  return {
    helped: aPass && (!bPass || (bTurns != null && aTurns != null && aTurns < bTurns)),
    beforePass: bPass,
    afterPass: aPass,
    turnDelta: bTurns != null && aTurns != null ? aTurns - bTurns : null,
  };
}

export async function promoteAndInstall(cfg, scored, job, { install = false } = {}) {
  const prop = await proposeSkillFromFailure(cfg, {
    caseId: scored.id || job?.id,
    goal: job?.goal,
    failures: scored.failures || [],
    text: job?.text,
    toolTrace: job?.toolTrace,
  });
  let installed = null;
  if (install) {
    installed = await installProposal(cfg, prop.path, { force: true });
  }
  return { proposal: prop, installed };
}

/**
 * A/B: run case id once; if fail, install skill proposal and re-run once.
 * @returns {{ before, after?, delta, proposal?, installed? }}
 */
export async function runSkillAB(cfg, caseId, opts = {}) {
  if (!caseId) throw new Error("caseId required");
  const installOnFail = opts.installOnFail !== false;

  const beforeReport = await runEvalSuite({ cfg, id: caseId });
  const beforeCase = (beforeReport.results || [])[0] || {
    pass: beforeReport.passRate === 1,
    turns: beforeReport.meanTurns,
    id: caseId,
  };

  if (beforeCase.pass) {
    const delta = computeSkillDelta(beforeCase, beforeCase);
    await recordSkillLoopMetric(cfg, {
      caseId,
      ...delta,
      skipped: "already_pass",
    });
    return { before: beforeCase, after: beforeCase, delta, skipped: "already_pass" };
  }

  let proposal = null;
  let installed = null;
  if (installOnFail) {
    const promo = await promoteAndInstall(
      cfg,
      beforeCase,
      {
        id: caseId,
        goal: beforeCase.goal || caseId,
        text: beforeCase.text,
        toolTrace: beforeCase.toolTrace,
      },
      { install: true }
    );
    proposal = promo.proposal;
    installed = promo.installed;
  }

  const afterReport = await runEvalSuite({ cfg, id: caseId });
  const afterCase = (afterReport.results || [])[0] || {
    pass: afterReport.passRate === 1,
    turns: afterReport.meanTurns,
    id: caseId,
  };

  const delta = computeSkillDelta(beforeCase, afterCase);
  await recordSkillLoopMetric(cfg, {
    caseId,
    ...delta,
    proposal: proposal?.path,
    installed: installed?.path,
  });

  return { before: beforeCase, after: afterCase, delta, proposal, installed };
}

/**
 * Batch A/B over tags or ids.
 */
export async function runSkillABBatch(cfg, { tag, ids, limit = 10 } = {}) {
  let caseIds = ids || [];
  if (tag) {
    const cases = await loadCases({ tag });
    caseIds = cases.map((c) => c.id).slice(0, limit);
  }
  const results = [];
  for (const id of caseIds.slice(0, limit)) {
    try {
      results.push({ caseId: id, ...(await runSkillAB(cfg, id)) });
    } catch (err) {
      results.push({ caseId: id, error: err.message });
    }
  }
  const helped = results.filter((r) => r.delta?.helped).length;
  const measured = results.filter((r) => r.delta && !r.skipped).length;
  return {
    results,
    helped,
    measured,
    helpRate: measured ? helped / measured : null,
  };
}
