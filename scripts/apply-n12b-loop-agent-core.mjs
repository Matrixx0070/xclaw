#!/usr/bin/env node
/** Idempotent land of agent-core wires into src/agent/loop.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fp = path.join(root, "src/agent/loop.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes('from "./high-risk-receipt.mjs"')) {
  t = t.replace(
    'import { createLoopGuard } from "./loop-guards.mjs";',
    `import { createLoopGuard } from "./loop-guards.mjs";\nimport { guardHighRiskReceipt } from "./high-risk-receipt.mjs";\nimport { createCostGovernor } from "./cost-governor.mjs";\nimport { recordToolTokens } from "./token-cache-metrics.mjs";\nimport { runHallucinationCanary } from "./hallucination-canary.mjs";`
  );
  n++;
}
if (!t.includes("createCostGovernor(cfg")) {
  t = t.replace(
    "  const guard = createLoopGuard(cfg.agent?.loopGuard || {});",
    "  const guard = createLoopGuard(cfg.agent?.loopGuard || {});\n  const costGov = createCostGovernor(cfg, options.job || options.jobState || {});"
  );
  n++;
}
if (!t.includes("costGov.check")) {
  t = t.replace(
    `    for (turns = 0; !hookAbort && turns < maxTurns; turns++) {\n      if (signal?.aborted) throw new Error("aborted");\n\n      // Feature 3 — cost governor hard stop (no provider call when over budget)`,
    `    for (turns = 0; !hookAbort && turns < maxTurns; turns++) {\n      if (signal?.aborted) throw new Error("aborted");\n\n      try {\n        const cg = costGov.check({ toolCalls: toolTrace.length });\n        if (cg.blocked) {\n          onEvent({ type: "cost", phase: "governor_blocked", ...cg });\n          finalText = finalText || \`COST_GOVERNOR: ${cg.reason}\`;\n          budgetStop = true;\n          aborted = true;\n          break;\n        }\n      } catch { /* */ }\n\n      // Feature 3 — cost governor hard stop (no provider call when over budget)`
  );
  n++;
}
if (!t.includes("guardHighRiskReceipt(name")) {
  t = t.replace(
    `        onEvent({ type: "tool", phase: "start", name, args });\n        const tracePartial = beginToolTraceEntry({`,
    `        const riskR = guardHighRiskReceipt(name, options.job || options.jobState || { evidence: options.evidence, receipt: options.receipt, toolTrace }, cfg);\n        if (!riskR.ok) {\n          const msg = riskR.message || "RECEIPT_REQUIRED";\n          onEvent({ type: "security", phase: "receipt_required", name, ...riskR });\n          messages.push(makeToolMessage({ tool_call_id: call.id, content: msg, source: "receipt" }));\n          recordTrace(finalizeToolTraceEntry(beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }), { resultText: msg, blocked: true, policy: { phase: "receipt", decision: "deny", reason: riskR.code || "RECEIPT_REQUIRED" } }));\n          return;\n        }\n\n        onEvent({ type: "tool", phase: "start", name, args });\n        const tracePartial = beginToolTraceEntry({`
  );
  n++;
}
if (!t.includes("hallucinationCanary")) {
  t = t.replace(
    `  return {\n    text: stripClaimsBlock(finalText) || "(no response)",`,
    `  let hallucinationCanary = null;\n  try {\n    hallucinationCanary = runHallucinationCanary({ text: finalText, toolTrace });\n    if (hallucinationCanary && !hallucinationCanary.ok) {\n      onEvent({ type: "canary", phase: "ungrounded", ...hallucinationCanary });\n    }\n  } catch { /* */ }\n\n  return {\n    text: stripClaimsBlock(finalText) || "(no response)",\n    canary: hallucinationCanary,`
  );
  n++;
}

fs.writeFileSync(fp, t);
console.log(JSON.stringify({ ok: true, applied: n, path: fp }));
