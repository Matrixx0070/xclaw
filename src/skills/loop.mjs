/**
 * Skill learning closed loop + A/B harness (Phase L).
 * fail → propose → install → re-run same case → record delta.
 *
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null. No home
 * fallback. Do not honour `XCLAW_STATE_DIR`. A cfg without configDir is
 * never a real caller (`loadConfig()` stamps it unconditionally).
 * `recordSkillLoopMetric` no-ops without persisting (do not `mkdir(null)`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { proposeSkillFromFailure, installProposal, canInstallSkills } from "./propose.mjs";
import { loadCases, runEvalSuite } from "../eval/runner.mjs";

export function metricsPath(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "skill-loop-metrics.jsonl") : null;
}

export async function recordSkillLoopMetric(cfg, row) {
  const fp = metricsPath(cfg);
  if (!fp) return null;
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.appendFile(
    fp,
    JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"
  );
  return fp;
}

export async function readSkillLoopMetrics(cfg, limit = 50) {
  const fp = metricsPath(cfg);
  if (!fp) return [];
  try {
    const raw = await fs.readFile(fp, "utf8");
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

export async function promoteAndInstall(cfg, scored, job, { install = false, ownerApproved = false } = {}) {
  const prop = await proposeSkillFromFailure(cfg, {
    caseId: scored.id || job?.id,
    goal: job?.goal,
    failures: scored.failures || [],
    text: job?.text,
    toolTrace: job?.toolTrace,
  });
  let installed = null;
  if (install) {
    const gate = canInstallSkills(cfg, { ownerApproved });
    if (!gate.ok) {
      installed = { ok: false, installed: false, ...gate };
    } else {
      installed = await installProposal(cfg, prop.path, {
        force: true,
        ownerApproved,
      });
    }
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
