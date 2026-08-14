#!/usr/bin/env node
/**
 * P2 — Multi-step tool eval under cost budget.
 *
 * Usage:
 *   XAI_API_KEY=... node scripts/p2-multistep-eval.mjs
 *   XCLAW_EVAL_BUDGET_USD=0.05 node scripts/p2-multistep-eval.mjs
 *
 * Exit 0 = goal met under budget; 1 = soft fail; 2 = hard fail
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/config/load.mjs";
import { runAgentLoop } from "../src/agent/loop.mjs";
import { isComputerRunning, startComputer } from "../src/computer/manager.mjs";

const budgetUsd = Number(process.env.XCLAW_EVAL_BUDGET_USD || 0.05);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const work = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-p2-eval-"));
const marker = path.join(work, "done.txt");

const cfg = await loadConfig();
cfg.profile = cfg.profile || "lab";
cfg.agent = {
  ...(cfg.agent || {}),
  maxTurns: 10,
  toolPack: "act",
};
cfg.security = { ...(cfg.security || {}), autoApprove: true };
cfg.tokens = { ...(cfg.tokens || {}), autoSession: true };

if (!(await isComputerRunning(cfg))) {
  console.error("[p2-eval] starting computer…");
  await startComputer({ root, foreground: false });
}

const sessionId = `p2-eval-${Date.now().toString(36)}`;
const goal =
  `Using tools only: create directory ${work}/out, write file ${work}/out/hello.txt ` +
  `with exact content xclaw-p2-ok, then write ${marker} with one line DONE. ` +
  `Finish with the single word: OK`;

console.error(`[p2-eval] session=${sessionId} budget=$${budgetUsd} work=${work}`);

const result = await runAgentLoop({
  userMessage: goal,
  cfg,
  chatSessionId: sessionId,
  onEvent: (e) => {
    if (e.type === "tool" && e.phase === "start") {
      console.error(`  → ${e.name}`);
    }
    if (e.type === "cache" && e.phase === "turn_hit_rate") {
      console.error(`  · cache ${e.cacheHitRatePct}%`);
    }
  },
});

const cost = Number(result.usage?.costUsd || 0);
let hello = "";
let done = "";
try {
  hello = await fs.readFile(path.join(work, "out/hello.txt"), "utf8");
} catch {
  /* missing */
}
try {
  done = await fs.readFile(marker, "utf8");
} catch {
  /* missing */
}

const checks = {
  helloOk: hello.trim() === "xclaw-p2-ok",
  doneOk: done.includes("DONE"),
  underBudget: cost <= budgetUsd || !result.usage?.hasCost,
  textOk: /OK/i.test(result.text || ""),
};

const ok = checks.helloOk && checks.doneOk && checks.underBudget;
const report = {
  ok,
  checks,
  costUsd: cost,
  budgetUsd,
  turns: result.turns,
  sessionId,
  textPreview: String(result.text || "").slice(0, 200),
  usage: result.usage || null,
};

console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : checks.helloOk || checks.doneOk ? 1 : 2);
