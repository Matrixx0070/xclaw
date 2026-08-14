#!/usr/bin/env node
/**
 * D — Swarm node failure path + receipt policy.
 *
 * Simulates a 3-node graph without live LLM:
 *   prepare (ok) → work (fail) → finish (depends on work)
 *
 * Asserts onDepFail policies:
 *   skip-downstream — finish skipped with UPSTREAM_FAILED
 *   fail-fast       — same skip + no further waves
 *   best-effort     — finish still "attempted" (marked ran without dep success)
 *
 * Also attaches receipts for ok/fail/skipped and evaluates receipt policy.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  attachNodeReceipt,
  buildRunReceiptSummary,
  evaluateReceiptPolicy,
  hasReceipt,
} from "../src/agents/swarm-receipt.mjs";
import { topologicalWaves } from "../src/agents/graph-viz.mjs";

const POLICIES = ["skip-downstream", "fail-fast", "best-effort"];

function depsAllSucceeded(node, resultsById) {
  for (const d of node.dependsOn || []) {
    const r = resultsById.get(d);
    if (!r || !r.ok) return false;
  }
  return true;
}

/**
 * Deterministic mini-runner mirroring swarm-run onDepFail branches.
 */
async function runGraph(cfg, policy) {
  const nodesSpec = [
    {
      id: "prepare",
      goal: "prepare workspace",
      dependsOn: [],
      role: "implement",
    },
    {
      id: "work",
      goal: "do risky work",
      dependsOn: ["prepare"],
      role: "implement",
    },
    {
      id: "finish",
      goal: "finish task",
      dependsOn: ["work"],
      role: "verify",
    },
  ];
  const waves = topologicalWaves(nodesSpec);
  const resultsById = new Map();
  const results = [];
  let abortRemaining = false;
  const swarmId = `p2-fail-${policy}`;

  // Forced outcomes for executed nodes
  const forced = {
    prepare: { ok: true, status: "done", text: "prepared" },
    work: {
      ok: false,
      status: "error",
      text: "",
      error: "forced failure (D)",
      code: "FORCED_FAIL",
    },
  };

  for (const wave of waves) {
    if (abortRemaining) {
      for (const n of wave) {
        if (resultsById.has(n.id)) continue;
        const skipRes = {
          nodeId: n.id,
          role: n.role,
          ok: false,
          status: "skipped",
          code: "FAIL_FAST",
          error: "skipped: fail-fast after upstream error",
          dependsOn: n.dependsOn || [],
        };
        await attachNodeReceipt(cfg, skipRes, {
          swarmId,
          nodeId: n.id,
          goal: n.goal,
        });
        resultsById.set(n.id, skipRes);
        results.push(skipRes);
      }
      break;
    }

    for (const n of wave) {
      if (policy !== "best-effort" && !depsAllSucceeded(n, resultsById)) {
        const failedDeps = (n.dependsOn || []).filter((d) => {
          const r = resultsById.get(d);
          return r && !r.ok;
        });
        const skipRes = {
          nodeId: n.id,
          role: n.role,
          ok: false,
          status: "skipped",
          code: "UPSTREAM_FAILED",
          error: `skipped: upstream failed (${failedDeps.join(", ") || "deps"})`,
          dependsOn: n.dependsOn || [],
          failedDeps,
        };
        await attachNodeReceipt(cfg, skipRes, {
          swarmId,
          nodeId: n.id,
          goal: n.goal,
        });
        resultsById.set(n.id, skipRes);
        results.push(skipRes);
        if (policy === "fail-fast") {
          abortRemaining = true;
        }
        continue;
      }

      const base = forced[n.id] || {
        ok: true,
        status: "done",
        text: `${n.id} complete (best-effort)`,
      };
      const nodeResult = {
        nodeId: n.id,
        role: n.role,
        id: `spawn_${n.id}`,
        ok: base.ok,
        status: base.status,
        text: base.text || "",
        error: base.error || null,
        code: base.code || null,
        toolTrace: base.ok
          ? [{ name: "xclaw_bash", ok: true }]
          : [{ name: "xclaw_bash", ok: false }],
        dependsOn: n.dependsOn || [],
      };
      await attachNodeReceipt(cfg, nodeResult, {
        swarmId,
        nodeId: n.id,
        goal: n.goal,
      });
      resultsById.set(n.id, nodeResult);
      results.push(nodeResult);
      if (!nodeResult.ok && policy === "fail-fast") {
        // fail-fast triggers when dependents are considered; also stop new waves
        abortRemaining = true;
      }
    }
  }

  const summary = buildRunReceiptSummary(results);
  const receiptPolicy = evaluateReceiptPolicy(results, {
    requireReceipts: true,
    criticalRoles: ["implement", "verify"],
  });

  return {
    policy,
    waves: waves.map((w) => w.map((n) => n.id)),
    results: results.map((r) => ({
      nodeId: r.nodeId,
      ok: r.ok,
      status: r.status,
      code: r.code || null,
      hasReceipt: hasReceipt(r),
      receiptId: r.receiptId || null,
    })),
    summary,
    receiptPolicy,
  };
}

function assertPolicy(report) {
  const by = Object.fromEntries(report.results.map((r) => [r.nodeId, r]));
  const errs = [];

  if (!by.prepare?.ok) errs.push("prepare should succeed");
  if (by.work?.ok) errs.push("work should fail");
  if (!by.work?.hasReceipt) errs.push("failed work must still have receipt");

  if (report.policy === "best-effort") {
    if (!by.finish) errs.push("best-effort should run finish");
    if (by.finish?.status === "skipped")
      errs.push("best-effort finish must not be UPSTREAM skipped");
  } else {
    if (by.finish?.status !== "skipped")
      errs.push(`${report.policy}: finish should be skipped`);
    if (by.finish?.code !== "UPSTREAM_FAILED" && by.finish?.code !== "FAIL_FAST")
      errs.push(`${report.policy}: finish code should be UPSTREAM_FAILED`);
    if (!by.finish?.hasReceipt)
      errs.push("skipped finish must still have receipt");
  }

  if (report.summary.withReceipt !== report.results.length) {
    errs.push("every node should carry a receipt");
  }

  return errs;
}

const cfg = {
  paths: {
    configDir: await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-p2-fail-")),
  },
};

const reports = [];
let ok = true;
for (const policy of POLICIES) {
  const report = await runGraph(cfg, policy);
  const errs = assertPolicy(report);
  report.assertOk = errs.length === 0;
  report.assertErrors = errs;
  if (!report.assertOk) ok = false;
  reports.push(report);
}

const out = {
  ok,
  cases: reports,
};

console.log(JSON.stringify(out, null, 2));
process.exit(ok ? 0 : 1);
