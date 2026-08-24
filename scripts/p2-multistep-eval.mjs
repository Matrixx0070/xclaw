#!/usr/bin/env node
/**
 * P2 — Multi-step tool eval under cost budget (agent E2E).
 *
 * Usage:
 *   XAI_API_KEY=... node scripts/p2-multistep-eval.mjs
 *   XCLAW_EVAL_BUDGET_USD=0.10 XCLAW_COMPUTER_ENGINE=native node scripts/p2-multistep-eval.mjs
 *
 * Exit 0 = goal met under budget; 1 = soft fail; 2 = hard fail
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/load.mjs";
import { runAgentLoop } from "../src/agent/loop.mjs";
import { isComputerRunning, startComputer } from "../src/computer/manager.mjs";
import { resolveComputerEngine } from "../src/computer/engine.mjs";

const budgetUsd = Number(process.env.XCLAW_EVAL_BUDGET_USD || 0.10);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-p2-eval-"));
const marker = path.join(work, "done.txt");
const helloPath = path.join(work, "out", "hello.txt");

const xaiKey =
  process.env.XAI_API_KEY ||
  process.env.XCLAW_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

if (!xaiKey) {
  console.error("[p2-eval] FAIL: set XAI_API_KEY (or XCLAW_API_KEY) for live agent E2E");
  process.exit(2);
}

const cfg = await loadConfig();
cfg.profile = process.env.XCLAW_PROFILE || cfg.profile || "lab";

// Single native engine (unification, ADR 0005)
const engine = "native";
process.env.XCLAW_COMPUTER_ENGINE = engine;

cfg.computer = {
  ...(cfg.computer || {}),
  autoStart: true,
};

// Pin provider for deterministic live runs when using xAI key shape
const usingXai = xaiKey.startsWith("xai-") || Boolean(process.env.XAI_API_KEY);
cfg.agent = {
  ...(cfg.agent || {}),
  maxTurns: Number(process.env.XCLAW_EVAL_MAX_TURNS || 10),
  toolPack: "act",
  allowTools: [
    "xclaw_bash",
    "xclaw_file_write",
    "xclaw_file_read",
    "xclaw_file_edit",
  ],
  apiKey: xaiKey,
  ...(usingXai
    ? {
        provider: "xai",
        baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
        model: process.env.XCLAW_MODEL || cfg.agent?.model || "grok-3",
      }
    : {}),
};
cfg.security = { ...(cfg.security || {}), autoApprove: true };
cfg.tokens = { ...(cfg.tokens || {}), autoSession: true };
cfg.router = { ...(cfg.router || {}), roleEffortEnabled: false };

const resolvedEngine = resolveComputerEngine(cfg);
console.error(
  `[p2-eval] engine=${resolvedEngine} hasBundle=${hasBundle} model=${cfg.agent.model} provider=${cfg.agent.provider || "?"} budget=$${budgetUsd}`
);

if (!(await isComputerRunning(cfg))) {
  console.error("[p2-eval] starting computer…");
  await startComputer({ root, cfg, foreground: false });
}

const sessionId = `p2-eval-${Date.now().toString(36)}`;
const goal =
  `Using tools only (prefer xclaw_file_write; bash timeout must be ≤120 seconds if used): ` +
  `create directory ${work}/out, write file ${helloPath} ` +
  `with exact content xclaw-p2-ok, then write ${marker} with one line DONE. ` +
  `Finish with the single word: OK`;

console.error(`[p2-eval] session=${sessionId} work=${work}`);

let result;
try {
  result = await runAgentLoop({
    userMessage: goal,
    cfg,
    chatSessionId: sessionId,
    onEvent: (e) => {
      if (e.type === "tool" && e.phase === "start") {
        console.error(`  → ${e.name}`);
      }
      if (e.type === "tool" && e.phase === "end" && e.error) {
        console.error(`  ✗ ${e.name}: ${String(e.error).slice(0, 120)}`);
      }
      if (e.type === "cache" && e.phase === "turn_hit_rate") {
        console.error(`  · cache ${e.cacheHitRatePct}%`);
      }
      if (e.type === "error") {
        console.error(`  ! ${e.message || e.error || JSON.stringify(e).slice(0, 160)}`);
      }
    },
  });
} catch (err) {
  console.error("[p2-eval] runAgentLoop threw:", err?.stack || err);
  const report = {
    ok: false,
    error: String(err?.message || err),
    work,
    sessionId,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

const cost = Number(result.usage?.costUsd || 0);
let hello = "";
let done = "";
try {
  hello = await fs.readFile(helloPath, "utf8");
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
  engine: resolvedEngine,
  model: cfg.agent.model,
  textPreview: String(result.text || "").slice(0, 200),
  usage: result.usage || null,
  helloPreview: hello.trim().slice(0, 80),
  donePreview: done.trim().slice(0, 80),
};

console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : checks.helloOk || checks.doneOk ? 1 : 2);
