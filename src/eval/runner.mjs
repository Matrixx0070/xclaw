/**
 * H0 — Eval runner: load cases, isolate workspace, runJob, score.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runJob, saveJobSummary } from "../jobs/job.mjs";
import { scoreCase } from "./scorer.mjs";
import { recordSkillOutcome } from "../skills/registry.mjs";
import { proposeSkillFromFailure } from "../skills/propose.mjs";
import { ensureComputer } from "../computer/ensure.mjs";
import { appendEvalHistory } from "./history.mjs";
import { estimateUsd } from "./cost.mjs";
import { recordCaseOutcome } from "./quarantine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EVAL_ROOT = path.resolve(__dirname, "../../eval");

export async function loadCases({ tag, id } = {}) {
  const dir = path.join(EVAL_ROOT, "cases");
  const files = await fs.readdir(dir);
  const cases = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
    const list = Array.isArray(raw) ? raw : [raw];
    for (const c of list) cases.push(c);
  }
  return cases.filter((c) => {
    if (id && c.id !== id) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    return true;
  });
}

async function prepareWorkspace(caseDef, runId) {
  const root = path.join(os.tmpdir(), "xclaw-eval", runId, caseDef.id);
  await fs.mkdir(root, { recursive: true });
  const fixtureName = caseDef.sandbox?.fixture || caseDef.fixture || "empty";
  const fixtureDir = path.join(EVAL_ROOT, "fixtures", fixtureName);
  try {
    await copyDir(fixtureDir, root);
  } catch {
    // empty fixture ok
  }
  return root;
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  let entries;
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/**
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {string} [opts.tag]
 * @param {string} [opts.id]
 * @param {boolean} [opts.mock] skip live model — dry score structure only
 */
export async function runEvalSuite(opts = {}) {
  const { cfg, tag, id, mock = false, onEvent } = opts;
  const cases = await loadCases({ tag, id });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const results = [];

  // Ensure computer is up for live runs (robust retries)
  if (!mock) {
    const ready = await ensureComputer(cfg, {
      root: path.resolve(__dirname, "../.."),
      attempts: 3,
    });
    if (!ready.ok) {
      console.error("[xclaw eval] computer unavailable:", ready.error);
    }
  }

  for (const caseDef of cases) {
    const workspace = await prepareWorkspace(caseDef, runId);
    let job;
    if (mock) {
      job = {
        id: `mock_${caseDef.id}`,
        goal: caseDef.prompt,
        workspace,
        status: "succeeded",
        pass: true,
        turns: 0,
        toolCalls: 0,
        toolErrors: 0,
        wallMs: 0,
        text: "",
        toolTrace: [],
        verify: await (await import("../jobs/verify.mjs")).runVerifyChecks(
          workspace,
          caseDef.expect?.success || []
        ),
        evidence: [],
        events: [],
      };
      // mock without agent will fail file checks — mark as skipped-live
      job.status = "failed";
      job.pass = false;
      job.mock = true;
    } else {
      job = await runJob({
        id: `${runId}_${caseDef.id}`,
        goal: caseDef.prompt,
        cfg,
        workspace,
        verify: caseDef.expect?.success || [],
        maxTurns: caseDef.maxTurns || cfg.agent?.maxTurns || 8,
        timeoutMs: caseDef.timeoutMs || 180_000,
        autoApprove: true,
        groundHard: Boolean(
          caseDef.groundHard ||
            caseDef.expect?.requireEvidence ||
            cfg.jobs?.groundHard
        ),
        claimsRequireEvidence: Boolean(
          caseDef.expect?.claimsRequireEvidence || cfg.jobs?.claimsRequireEvidence
        ),
        requireStructuredClaims: Boolean(
          caseDef.expect?.requireStructuredClaims ||
            cfg.jobs?.requireStructuredClaims ||
            (cfg.jobs?.structuredClaimsOnTags || ["campaign", "long", "campaign-v2"]).some(
              (t) => (caseDef.tags || []).includes(t)
            )
        ),
        onEvent,
      });
      await saveJobSummary(job).catch(() => {});
    }

    const scored = await scoreCase(caseDef, job);
    // H2: attribute outcome to skills named in case or tags
    const skillNames = caseDef.skills || (caseDef.tags || []).filter((x) => x.startsWith("skill:"));
    if (!mock && skillNames.length) {
      await recordSkillOutcome(cfg, skillNames, scored.pass, scored.turns).catch(() => {});
    }
    if (!mock && !scored.pass && cfg.eval?.proposeSkills !== false) {
      const prop = await proposeSkillFromFailure(cfg, {
        caseId: caseDef.id,
        goal: caseDef.prompt,
        failures: scored.failures,
        text: job.text,
        toolTrace: job.toolTrace,
      }).catch(() => null);
      if (prop) scored.proposal = prop.path;
    }
    const usage = job.usage || {};
    results.push({
      ...scored,
      name: caseDef.name,
      tags: caseDef.tags,
      mock: Boolean(mock),
      workspace,
      model: job.model,
      usage: {
        promptTokens: usage.promptTokens ?? usage.prompt_tokens ?? null,
        completionTokens: usage.completionTokens ?? usage.completion_tokens ?? null,
        totalTokens: usage.totalTokens ?? usage.total_tokens ?? null,
        hasRealUsage: Boolean(usage.hasRealUsage),
      },
      proposal: scored.proposal || null,
    });
    try {
      if (!mock) await recordCaseOutcome(cfg, scored.id, Boolean(scored.pass));
    } catch {
      /* non-fatal */
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const promptTok = results.reduce((s, r) => s + (r.usage?.promptTokens || 0), 0);
  const completionTok = results.reduce((s, r) => s + (r.usage?.completionTokens || 0), 0);
  const report = {
    runId,
    at: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 0,
    meanTurns: avg(results.map((r) => r.turns)),
    meanWallMs: avg(results.map((r) => r.wallMs)),
    tokens: {
      prompt: promptTok,
      completion: completionTok,
      total: promptTok + completionTok,
    },
    cost: estimateUsd(
      { prompt: promptTok, completion: completionTok },
      results.find((x) => x.model)?.model
    ),
    results,
  };
  if (!mock && results.length) {
    await appendEvalHistory(cfg, report).catch(() => {});
  }
  return report;
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function formatEvalReport(report) {
  const lines = [
    `XClaw eval ${report.runId}`,
    `pass ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)`,
    `mean turns ${report.meanTurns.toFixed(2)} · mean wall ms ${report.meanWallMs.toFixed(0)}`,
    report.tokens
      ? `tokens in ${report.tokens.prompt} / out ${report.tokens.completion} / total ${report.tokens.total}`
      : null,
    report.cost?.usd != null ? `est. cost ~$${report.cost.usd}` : null,
    "",
  ].filter((x) => x != null);
  for (const r of report.results) {
    const mark = r.pass ? "PASS" : "FAIL";
    lines.push(
      `[${mark}] ${r.id} turns=${r.turns} tools=${r.toolCalls} ${r.failures?.length ? "· " + r.failures.join("; ") : ""}`
    );
  }
  return lines.join("\n");
}
