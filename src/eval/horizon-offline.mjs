/**
 * Offline long-horizon graders for G10/G11/G13 synthetic jobs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadCases, EVAL_ROOT } from "./runner.mjs";
import { scoreCase } from "./scorer.mjs";
import { scoreAutonomyRun } from "./autonomy-metrics.mjs";
import {
  incHorizonPass,
  incHorizonFail,
  renderHorizonMetrics,
} from "./horizon-metrics.mjs";

export async function runHorizonOffline(opts = {}) {
  const ids = opts.ids || [
    "a4-G10-plan-write-verify-fix",
    "a4-G11-tool-fail-recover",
    "a4-G13-canary-then-ground",
  ];
  const results = [];
  for (const id of ids) {
    const cases = await loadCases({ id });
    if (!cases.length) {
      results.push({ id, ok: false, reason: "missing_case" });
      incHorizonFail();
      continue;
    }
    const caseDef = cases[0];
    const jobLike = opts.jobs?.[id] || null;
    if (!jobLike) {
      results.push({ id, ok: false, reason: "no_job", caseDef });
      continue;
    }
    const scored = await scoreCase(caseDef, jobLike);
    const auto = scoreAutonomyRun(jobLike, scored);
    if (scored.pass) incHorizonPass();
    else incHorizonFail();
    results.push({ id, ok: scored.pass, scored, auto });
  }
  return {
    ok: results.filter((r) => r.reason !== "no_job").every((r) => r.ok),
    results,
    metrics: renderHorizonMetrics(),
    evalRoot: EVAL_ROOT,
    at: new Date().toISOString(),
  };
}

export async function syntheticG10Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "plan.txt"), "PLAN-OK\n");
  await fs.writeFile(path.join(workspace, "data.txt"), "VALUE=2\n");
  return {
    text: "Planned, wrote, verified, fixed VALUE=2",
    turns: 4,
    toolTrace: [
      { name: "xclaw_file_write", status: "ok" },
      { name: "xclaw_file_read", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 3,
    toolErrors: 0,
    wallMs: 50,
    status: "succeeded",
    workspace,
  };
}

export async function syntheticG11Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "recover.txt"), "RECOVERED\n");
  return {
    text: "Recovered after tool failure",
    turns: 3,
    toolTrace: [
      { name: "xclaw_file_write", status: "error" },
      { name: "xclaw_file_write", status: "ok" },
      { name: "xclaw_file_read", status: "ok" },
    ],
    toolCalls: 3,
    toolErrors: 1,
    wallMs: 40,
    status: "succeeded",
    workspace,
  };
}

export async function syntheticG13Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "grounded.txt"), "GROUNDED-OK\n");
  return {
    text: "Wrote and verified grounded.txt with tools",
    turns: 2,
    toolTrace: [
      { name: "xclaw_file_write", status: "ok" },
      { name: "xclaw_file_read", status: "ok" },
    ],
    toolCalls: 2,
    toolErrors: 0,
    wallMs: 30,
    status: "succeeded",
    workspace,
  };
}

export async function runHorizonSuiteOffline(opts = {}) {
  const workspace = opts.workspace;
  const jobs = { ...(opts.jobs || {}) };
  if (!jobs["a4-G10-plan-write-verify-fix"] && workspace) {
    jobs["a4-G10-plan-write-verify-fix"] = await syntheticG10Job(
      path.join(workspace, "g10")
    );
  }
  if (!jobs["a4-G11-tool-fail-recover"] && workspace) {
    jobs["a4-G11-tool-fail-recover"] = await syntheticG11Job(
      path.join(workspace, "g11")
    );
  }
  if (!jobs["a4-G13-canary-then-ground"] && workspace) {
    jobs["a4-G13-canary-then-ground"] = await syntheticG13Job(
      path.join(workspace, "g13")
    );
  }
  return runHorizonOffline({
    ids: opts.ids || [
      "a4-G10-plan-write-verify-fix",
      "a4-G11-tool-fail-recover",
      "a4-G13-canary-then-ground",
    ],
    jobs,
  });
}

export default {
  runHorizonOffline,
  runHorizonSuiteOffline,
  syntheticG10Job,
  syntheticG11Job,
  syntheticG13Job,
};
