/**
 * Offline long-horizon graders for G10–G14 synthetic jobs.
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
import { incG14Pass } from "./horizon-g14-metrics.mjs";
import { incG15Pass } from "./horizon-g15-metrics.mjs";
import { incG16Pass } from "./horizon-g16-metrics.mjs";
import { incG17Pass } from "./horizon-g17-metrics.mjs";
import { incG18Pass } from "./horizon-g18-metrics.mjs";
import { incG19Pass } from "./horizon-g19-metrics.mjs";
import { incG20Pass } from "./horizon-g20-metrics.mjs";

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
    if (scored.pass) {
      incHorizonPass();
      if (id.includes("G14")) incG14Pass();
      if (id.includes("G15")) incG15Pass();
      if (id.includes("G16")) incG16Pass();
      if (id.includes("G17")) incG17Pass();
      if (id.includes("G18")) incG18Pass();
      if (id.includes("G19")) incG19Pass();
      if (id.includes("G20")) incG20Pass();
    } else incHorizonFail();
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

export async function syntheticG12Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "budget.txt"), "BUDGET-OK\n");
  return {
    text: "Finished under budget with BUDGET-OK",
    turns: 2,
    toolTrace: [
      { name: "xclaw_file_write", status: "ok" },
      { name: "xclaw_file_read", status: "ok" },
    ],
    toolCalls: 2,
    toolErrors: 0,
    wallMs: 25,
    status: "succeeded",
    workspace,
  };
}

export async function syntheticG14Job(workspace) {
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspace, "src", "a.js"),
    'export function foo() { return "a"; }\n'
  );
  await fs.writeFile(
    path.join(workspace, "src", "b.js"),
    'import { foo } from "./a.js";\nconsole.log(foo());\n'
  );
  await fs.writeFile(path.join(workspace, "verify.txt"), "OK\n");
  return {
    text: "Fixed import bar->foo and wrote verify.txt OK",
    turns: 3,
    toolTrace: [
      { name: "xclaw_file_read", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 3,
    toolErrors: 0,
    wallMs: 40,
    status: "succeeded",
    workspace,
  };
}

export async function runHorizonSuiteOffline(opts = {}) {
  // __horizonIncludeAll
  if (opts.includeAll === true || opts.all === true) {
    opts = {
      ...opts,
      includeG12: true,
      includeG14: true,
      includeG15: true,
      includeG16: true,
      includeG17: true,
      includeG18: true,
      includeG19: true,
      includeG20: true,
    };
  }
  const workspace = opts.workspace;
  const jobs = { ...(opts.jobs || {}) };
  const includeG12 = opts.includeG12 !== false;
  const includeG14 = opts.includeG14 !== false;
  const includeG15 = opts.includeG15 === true;
  const includeG16 = opts.includeG16 === true;
  const includeG17 = opts.includeG17 === true;
  const includeG18 = opts.includeG18 === true;
  const includeG19 = opts.includeG19 === true;
  const includeG20 = opts.includeG20 === true;
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
  if (!jobs["a4-G12-budget-near-limit"] && workspace && includeG12) {
    jobs["a4-G12-budget-near-limit"] = await syntheticG12Job(
      path.join(workspace, "g12")
    );
  }
  if (!jobs["a4-G14-multi-file-refactor"] && workspace && includeG14) {
    jobs["a4-G14-multi-file-refactor"] = await syntheticG14Job(
      path.join(workspace, "g14")
    );
  }
  if (!jobs["a4-G15-browser-form-fill"] && workspace && includeG15) {
    jobs["a4-G15-browser-form-fill"] = await syntheticG15Job(
      path.join(workspace, "g15")
    );
  }
  if (!jobs["a4-G16-swarm-ballot-merge"] && workspace && includeG16) {
    jobs["a4-G16-swarm-ballot-merge"] = await syntheticG16Job(
      path.join(workspace, "g16")
    );
  }
  if (!jobs["a4-G17-overnight-soak"] && workspace && includeG17) {
    jobs["a4-G17-overnight-soak"] = await syntheticG17Job(
      path.join(workspace, "g17")
    );
  }
  if (!jobs["a4-G18-oauth-refresh-midrun"] && workspace && includeG18) {
    jobs["a4-G18-oauth-refresh-midrun"] = await syntheticG18Job(
      path.join(workspace, "g18")
    );
  }
  if (!jobs["a4-G19-canary-partial-evidence"] && workspace && includeG19) {
    jobs["a4-G19-canary-partial-evidence"] = await syntheticG19Job(
      path.join(workspace, "g19")
    );
  }
  if (!jobs["a4-G20-cost-stop-resume"] && workspace && includeG20) {
    jobs["a4-G20-cost-stop-resume"] = await syntheticG20Job(
      path.join(workspace, "g20")
    );
  }
  return runHorizonOffline({
    ids: opts.ids || [
      "a4-G10-plan-write-verify-fix",
      "a4-G11-tool-fail-recover",
      "a4-G13-canary-then-ground",
      ...(includeG12 ? ["a4-G12-budget-near-limit"] : []),
      ...(includeG14 ? ["a4-G14-multi-file-refactor"] : []),
      ...(includeG15 ? ["a4-G15-browser-form-fill"] : []),
      ...(includeG16 ? ["a4-G16-swarm-ballot-merge"] : []),
      ...(includeG17 ? ["a4-G17-overnight-soak"] : []),
      ...(includeG18 ? ["a4-G18-oauth-refresh-midrun"] : []),
      ...(includeG19 ? ["a4-G19-canary-partial-evidence"] : []),
      ...(includeG20 ? ["a4-G20-cost-stop-resume"] : []),
    ],
    jobs,
  });
}


export async function syntheticG15Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "form.html"), "<html><body>form mock</body></html>\n");
  await fs.writeFile(path.join(workspace, "result.txt"), "SUBMITTED-OK\n");
  return {
    text: "Filled form via browser mock and wrote result.txt SUBMITTED-OK",
    turns: 3,
    toolTrace: [
      { name: "xclaw_browser_tab", status: "ok" },
      { name: "xclaw_browser_tab", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 3,
    toolErrors: 0,
    wallMs: 45,
    status: "succeeded",
    workspace,
  };
}


export async function syntheticG16Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "verdict.txt"), "APPROVE\n");
  await fs.writeFile(
    path.join(workspace, "receipt.json"),
    JSON.stringify({ vote: "approve", ballots: ["a", "b", "c"] }) + "\n"
  );
  return {
    text: "Merged majority approve; wrote verdict + receipt",
    turns: 3,
    toolTrace: [
      { name: "xclaw_file_read", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 3,
    toolErrors: 0,
    wallMs: 40,
    status: "succeeded",
    workspace,
  };
}


export async function syntheticG17Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "final.txt"), "SOAK-DONE\n");
  await fs.writeFile(
    path.join(workspace, "budget.json"),
    JSON.stringify({ ok: true, usedUsd: 0.25, maxUsd: 1.0 }) + "\n"
  );
  return {
    text: "Soak complete under budget; wrote final.txt",
    turns: 2,
    toolTrace: [
      { name: "xclaw_file_read", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 2,
    toolErrors: 0,
    wallMs: 30,
    status: "succeeded",
    workspace,
  };
}

export async function syntheticG18Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "done.txt"), "OAUTH-OK\n");
  await fs.writeFile(
    path.join(workspace, "tokens-out.json"),
    JSON.stringify({ refreshed: true, accessToken: "new-access" }) + "\n"
  );
  return {
    text: "Refreshed OAuth mid-run; wrote done.txt",
    turns: 3,
    toolTrace: [
      { name: "xclaw_file_read", status: "ok" },
      { name: "auth_refresh", status: "ok" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 3,
    toolErrors: 0,
    wallMs: 35,
    status: "succeeded",
    workspace,
  };
}

export async function syntheticG19Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "grounded.txt"), "CANARY-OK\n");
  await fs.writeFile(
    path.join(workspace, "canary.json"),
    JSON.stringify({ recovered: true, phase: "soft_recover" }) + "\n"
  );
  return {
    text: "Canary soft-recover then grounded write",
    turns: 3,
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

export async function syntheticG20Job(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "final.txt"), "COST-RESUME-OK\n");
  await fs.writeFile(
    path.join(workspace, "stop.json"),
    JSON.stringify({ blocked: true, resumed: true, reason: "COST_GOVERNOR" }) + "\n"
  );
  return {
    text: "Cost governor blocked then resumed under raised budget",
    turns: 3,
    toolTrace: [
      { name: "cost_governor", status: "blocked" },
      { name: "xclaw_file_write", status: "ok" },
    ],
    toolCalls: 2,
    toolErrors: 0,
    wallMs: 30,
    status: "succeeded",
    workspace,
  };
}
export default {
  runHorizonOffline,
  runHorizonSuiteOffline,
  syntheticG10Job,
  syntheticG11Job,
  syntheticG13Job,
  syntheticG12Job,
  syntheticG14Job,
  syntheticG15Job,
  syntheticG16Job,
  syntheticG17Job,
  syntheticG18Job,
  syntheticG19Job,
  syntheticG20Job,
};
