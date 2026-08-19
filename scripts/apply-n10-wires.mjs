#!/usr/bin/env node
/** Idempotent apply of complete-n10 wires. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function write(rel, t) {
  writeSourceIfChanged(path.join(root, rel), t);
}

function wireJob() {
  const rel = "src/jobs/job.mjs";
  let t = read(rel);
  if (t.includes("stampCostHardBlock")) return false;
  t = t.replace(
    'import { checkCostBudget, recordJobCost, estimateUsdFromUsage } from "../tokens/cost-governor.mjs";',
    'import { checkCostBudget, recordJobCost, estimateUsdFromUsage } from "../tokens/cost-governor.mjs";\nimport { stampCostHardBlock } from "../tokens/cost-hard-block.mjs";'
  );
  t = t.replace(
    `      if (!budget.ok) {\n        return {\n          id,\n          goal,\n          workspace,\n          status: "failed",\n          pass: false,\n          turns: 0,\n          toolCalls: 0,\n          toolErrors: 0,\n          wallMs: 0,\n          text: "",\n          error: budget.message || "cost hard cap",\n          code: budget.code || "BUDGET_EXCEEDED",\n          costBlocked: true,\n          evidence: [],\n        };\n      }\n`,
    `      if (!budget.ok) {\n        const denied = {\n          id,\n          goal,\n          workspace,\n          status: "failed",\n          pass: false,\n          turns: 0,\n          toolCalls: 0,\n          toolErrors: 0,\n          wallMs: 0,\n          text: "",\n          error: budget.message || "cost hard cap",\n          code: budget.code || "BUDGET_EXCEEDED",\n          costBlocked: true,\n          evidence: [],\n        };\n        await stampCostHardBlock(denied, budget);\n        return denied;\n      }\n`
  );
  write(rel, t);
  return true;
}

function wireCheckpoint() {
  const rel = "src/jobs/checkpoint.mjs";
  let t = read(rel);
  if (t.includes("rehydrateReceiptFromCheckpoint")) return false;
  t = t.replace(
    'import { stampJobToolHash } from "./stamp-tool-hash.mjs";',
    'import { stampJobToolHash } from "./stamp-tool-hash.mjs";\nimport { rehydrateReceiptFromCheckpoint } from "./checkpoint-receipt.mjs";'
  );
  t = t.replace(
    `  if (cp.pass) {\n    return {\n      ...cp,\n      resumed: false,\n      note: "already passed",\n`,
    `  rehydrateReceiptFromCheckpoint(cp, cp);\n  if (cp.pass) {\n    return {\n      ...cp,\n      resumed: false,\n      note: "already passed",\n`
  );
  t = t.replace(
    "  const jobOpts = {\n    id: `${cp.id}_resume_${Date.now().toString(36)}`,",
    "  rehydrateReceiptFromCheckpoint(cp, cp);\n  const jobOpts = {\n    id: `${cp.id}_resume_${Date.now().toString(36)}`,\n    receiptCollector: cp.receiptCollector || null,\n    quotaHardCircuit: cp.quotaHardCircuit || null,\n    quotaEscalate: cp.quotaEscalate || null,"
  );
  write(rel, t);
  return true;
}

function wireHistory() {
  const rel = "src/jobs/history.mjs";
  let t = read(rel);
  if (t.includes("costBlocked")) return false;
  t = t.replace(
    "    error: job.error || null,",
    "    error: job.error || null,\n    costBlocked: job.costBlocked || false,"
  );
  write(rel, t);
  return true;
}

function wireFireDrill() {
  const rel = "src/eval/stop-fire-drill.mjs";
  let t = read(rel);
  if (t.includes("fireDrillPostOffline")) return false;
  if (!t.includes("postStopSigned")) {
    t = t.replace(
      'import { isStopPath, handleStopAll } from "../gateway/stop-route.mjs";',
      'import { isStopPath, handleStopAll } from "../gateway/stop-route.mjs";\nimport { postStopSigned, buildStopSignResult } from "../cli/stop-sign.mjs";'
    );
  }
  const fn = `\nexport async function fireDrillPostOffline() {\n  const signed = buildStopSignResult(\n    { gateway: { token: "drill-token", host: "127.0.0.1", port: 9 } },\n    { dryRun: true }\n  );\n  const live = await postStopSigned(signed, {\n    timeoutMs: 200,\n    fetchImpl: async () => {\n      const e = new Error("fetch failed");\n      e.cause = { code: "ECONNREFUSED" };\n      throw e;\n    },\n  });\n  return {\n    name: "post_offline",\n    ok: live.ok === false && live.code === "GATEWAY_OFFLINE",\n    code: live.code,\n    error: live.error,\n  };\n}\n\n`;
  t = t.replace("export async function runStopFireDrill", fn + "export async function runStopFireDrill");
  t = t.replace(
    "    await fireDrillDryRun(),\n    fireDrillDrainAuthMethod(),",
    "    await fireDrillDryRun(),\n    await fireDrillPostOffline(),\n    fireDrillDrainAuthMethod(),"
  );
  write(rel, t);
  return true;
}

function wireOpenapi() {
  const rel = "docs/openapi-stop.yaml";
  let t = read(rel);
  if (t.includes("x-dry-run-response")) return false;
  t =
    t.trimEnd() +
    `\n\nx-dry-run-response:\n  description: Runtime payload when body.dryRun=true\n  type: object\n  required: [ok, dryRun, killedSessions]\n  properties:\n    ok: { type: boolean, example: true }\n    dryRun: { type: boolean, example: true }\n    killedSessions: { type: array, items: { type: string }, maxItems: 0 }\n    authMethod: { type: string }\n    message: { type: string }\n`;
  write(rel, t);
  return true;
}

function wireContract() {
  const rel = "src/ci/openapi-stop-contract.mjs";
  let t = read(rel);
  if (t.includes("x-dry-run-response")) return false;
  t = t.replace(
    'if (!yaml.includes("dryRun")) missing.push("dryRun");',
    'if (!yaml.includes("dryRun")) missing.push("dryRun");\n  if (!yaml.includes("x-dry-run-response")) missing.push("x-dry-run-response");'
  );
  write(rel, t);
  return true;
}

const NEEDLES = [
  ["src/jobs/job.mjs", "stampCostHardBlock"],
  ["src/jobs/checkpoint.mjs", "rehydrateReceiptFromCheckpoint"],
  ["src/jobs/history.mjs", "costBlocked"],
  ["src/eval/stop-fire-drill.mjs", "fireDrillPostOffline"],
  ["docs/openapi-stop.yaml", "x-dry-run-response"],
];

function needList() {
  return NEEDLES.filter(([f, n]) => {
    const fp = path.join(root, f);
    return !(fs.existsSync(fp) && fs.readFileSync(fp, "utf8").includes(n));
  }).map(([f, n]) => `${f}::${n}`);
}

if (check) {
  if (!needList().length) {
    console.error("[n10-wires] check OK");
    process.exit(0);
  }
  console.error("[n10-wires] NEED", needList().join(", "));
  process.exit(1);
}

const applied = [
  wireJob(),
  wireCheckpoint(),
  wireHistory(),
  wireFireDrill(),
  wireOpenapi(),
  wireContract(),
].filter(Boolean);
console.error("[n10-wires] applied", applied.length, "still", needList().join(", ") || "OK");
process.exit(needList().length ? 1 : 0);
