#!/usr/bin/env node
/** Idempotent land of agent-core wires into src/agent/loop.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fp = path.join(root, "src/agent/loop.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes('from "./high-risk-receipt.mjs"')) {
  t = t.replace(
    'import { createLoopGuard } from "./loop-guards.mjs";',
    'import { createLoopGuard } from "./loop-guards.mjs";\n' +
      'import { guardHighRiskReceipt } from "./high-risk-receipt.mjs";\n' +
      'import { createCostGovernor } from "./cost-governor.mjs";\n' +
      'import { recordToolTokens } from "./token-cache-metrics.mjs";\n' +
      'import { runHallucinationCanary } from "./hallucination-canary.mjs";'
  );
  n++;
}
if (!t.includes("createCostGovernor(cfg")) {
  t = t.replace(
    "  const guard = createLoopGuard(cfg.agent?.loopGuard || {});",
    "  const guard = createLoopGuard(cfg.agent?.loopGuard || {});\n" +
      "  const costGov = createCostGovernor(cfg, options.job || options.jobState || {});"
  );
  n++;
}
if (!t.includes("costGov.check")) {
  const old =
    "    for (turns = 0; !hookAbort && turns < maxTurns; turns++) {\n" +
    '      if (signal?.aborted) throw new Error("aborted");\n\n' +
    "      // Feature 3 \u2014 cost governor hard stop (no provider call when over budget)";
  const neu =
    "    for (turns = 0; !hookAbort && turns < maxTurns; turns++) {\n" +
    '      if (signal?.aborted) throw new Error("aborted");\n\n' +
    "      try {\n" +
    "        const cg = costGov.check({ toolCalls: toolTrace.length });\n" +
    "        if (cg.blocked) {\n" +
    '          onEvent({ type: "cost", phase: "governor_blocked", ...cg });\n' +
    "          finalText = finalText || `COST_GOVERNOR: ${cg.reason}`;\n" +
    "          budgetStop = true;\n" +
    "          aborted = true;\n" +
    "          break;\n" +
    "        }\n" +
    "      } catch { /* */ }\n\n" +
    "      // Feature 3 \u2014 cost governor hard stop (no provider call when over budget)";
  if (t.includes(old)) {
    t = t.replace(old, neu);
    n++;
  } else if (!t.includes("costGov.check")) {
    console.error("NEED: turn-boundary costGov needle");
  }
}
if (!t.includes("guardHighRiskReceipt(name")) {
  const old =
    '        onEvent({ type: "tool", phase: "start", name, args });\n' +
    "        const tracePartial = beginToolTraceEntry({";
  const neu =
    "        const riskR = guardHighRiskReceipt(name, options.job || options.jobState || { evidence: options.evidence, receipt: options.receipt, toolTrace }, cfg);\n" +
    "        if (!riskR.ok) {\n" +
    '          const msg = riskR.message || "RECEIPT_REQUIRED";\n' +
    '          onEvent({ type: "security", phase: "receipt_required", name, ...riskR });\n' +
    "          messages.push(makeToolMessage({ tool_call_id: call.id, content: msg, source: \"receipt\" }));\n" +
    "          recordTrace(finalizeToolTraceEntry(beginToolTraceEntry({ name, args, toolCallId: call.id, turn: turns + 1 }), { resultText: msg, blocked: true, policy: { phase: \"receipt\", decision: \"deny\", reason: riskR.code || \"RECEIPT_REQUIRED\" } }));\n" +
    "          return;\n" +
    "        }\n\n" +
    '        onEvent({ type: "tool", phase: "start", name, args });\n' +
    "        const tracePartial = beginToolTraceEntry({";
  if (t.includes(old)) {
    t = t.replace(old, neu);
    n++;
  } else if (!t.includes("guardHighRiskReceipt(name")) {
    console.error("NEED: receipt gate needle");
  }
}
if (!t.includes("hallucinationCanary")) {
  const old =
    "  return {\n" +
    '    text: stripClaimsBlock(finalText) || "(no response)",';
  const neu =
    "  let hallucinationCanary = null;\n" +
    "  try {\n" +
    "    hallucinationCanary = runHallucinationCanary({ text: finalText, toolTrace });\n" +
    "    if (hallucinationCanary && !hallucinationCanary.ok) {\n" +
    '      onEvent({ type: "canary", phase: "ungrounded", ...hallucinationCanary });\n' +
    "    }\n" +
    "  } catch { /* */ }\n\n" +
    "  return {\n" +
    '    text: stripClaimsBlock(finalText) || "(no response)",\n' +
    "    canary: hallucinationCanary,";
  if (t.includes(old)) {
    t = t.replace(old, neu);
    n++;
  } else if (!t.includes("hallucinationCanary")) {
    console.error("NEED: canary return needle");
  }
}

writeSourceIfChanged(fp, t);
console.log(JSON.stringify({ ok: true, applied: n, path: fp }));
