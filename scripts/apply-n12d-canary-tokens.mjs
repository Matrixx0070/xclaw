#!/usr/bin/env node
/** Idempotent: soft canary (1x), stampCostBlock, recordToolTokens on loop.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
spawnSync(process.execPath, [path.join(root, "scripts/apply-n12b-loop-agent-core.mjs")], {
  cwd: root,
  encoding: "utf8",
});

const fp = path.join(root, "src/agent/loop.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes('from "./canary-recover.mjs"')) {
  t = t.replace(
    'import { runHallucinationCanary } from "./hallucination-canary.mjs";',
    'import { runHallucinationCanary } from "./hallucination-canary.mjs";\n' +
      'import { softCanaryRecover } from "./canary-recover.mjs";\n' +
      'import { incCanaryUngrounded } from "./canary-metrics.mjs";\n' +
      'import { stampCostBlock } from "./cost-receipt.mjs";'
  );
  n++;
}
if (t.includes("governor_blocked") && !t.includes("stampCostBlock(")) {
  t = t.replace(
    'onEvent({ type: "cost", phase: "governor_blocked", ...cg });',
    'onEvent({ type: "cost", phase: "governor_blocked", ...cg });\n' +
      "          try { stampCostBlock(options.job || options.jobState || {}, cg); } catch { /* */ }"
  );
  n++;
}
if (t.includes("hallucinationCanary = runHallucinationCanary") && !t.includes("_canarySoftUsed")) {
  t = t.replace(
    "  let hallucinationCanary = null;\n  try {\n    hallucinationCanary = runHallucinationCanary({ text: finalText, toolTrace });\n    if (hallucinationCanary && !hallucinationCanary.ok) {\n      onEvent({ type: \"canary\", phase: \"ungrounded\", ...hallucinationCanary });\n    }\n  } catch { /* */ }",
    "  let hallucinationCanary = null;\n  try {\n    const softOnce = options._canarySoftUsed !== true;\n    if (softOnce) {\n      const soft = softCanaryRecover({ text: finalText, toolTrace, messages });\n      hallucinationCanary = soft.canary;\n      if (soft.recovered) {\n        options._canarySoftUsed = true;\n        onEvent({ type: \"canary\", phase: \"soft_recover\", ...soft.canary });\n      }\n    } else {\n      hallucinationCanary = runHallucinationCanary({ text: finalText, toolTrace });\n      if (hallucinationCanary && !hallucinationCanary.ok) {\n        incCanaryUngrounded(1);\n        onEvent({ type: \"canary\", phase: \"ungrounded\", ...hallucinationCanary });\n      }\n    }\n  } catch { /* */ }"
  );
  n++;
}
if (!t.includes("recordToolTokens(name,")) {
  const old =
    "        recordTrace(traceEntry);\n        onEvent({\n          type: \"tool\",\n          phase: \"end\",\n          name,";
  const neu =
    "        recordTrace(traceEntry);\n        try {\n          const u = result?.usage || result?.tokenUsage || {};\n          recordToolTokens(name, {\n            prompt: Number(u.prompt_tokens || u.prompt || 0),\n            completion: Number(u.completion_tokens || u.completion || 0),\n            cached: Number(u.cached_tokens || u.cached || 0),\n          });\n        } catch { /* */ }\n        onEvent({\n          type: \"tool\",\n          phase: \"end\",\n          name,";
  if (t.includes(old)) {
    t = t.replace(old, neu);
    n++;
  }
}

writeSourceIfChanged(fp, t);
console.log(JSON.stringify({ ok: true, applied: n, path: fp }));
