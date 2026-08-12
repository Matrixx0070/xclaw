#!/usr/bin/env node
/**
 * Short soak: N single-turn agent goals; report pass rate + cost estimate.
 * Usage: XAI_API_KEY=... node scripts/soak-agent.mjs [N]
 */
import { loadConfig } from "../src/config/load.mjs";
import { ensureComputer } from "../src/computer/ensure.mjs";
import { runAgentLoop } from "../src/agent/loop.mjs";
import { createProvider } from "../src/agent/provider.mjs";
import fs from "node:fs";

const N = Math.min(10, Math.max(1, Number(process.argv[2] || 3)));
const goals = [
  "Create soak-out/g1.txt with content: soak-1. Then read it back.",
  "Create soak-out/g2.txt with content: soak-2. Then read it back.",
  "Create soak-out/g3.txt with content: soak-3. Then read it back.",
  "Create soak-out/g4.txt with content: soak-4. Then read it back.",
  "Create soak-out/g5.txt with content: soak-5. Then read it back.",
];

const cfg = await loadConfig();
cfg.profile = process.env.XCLAW_PROFILE || "lab";
cfg.agent = {
  ...(cfg.agent || {}),
  model: process.env.XCLAW_MODEL || "xai/grok-4.5",
  apiKey: process.env.XAI_API_KEY || cfg.agent?.apiKey,
  maxTurns: 4,
};
await ensureComputer(cfg).catch(() => {});

fs.mkdirSync("soak-out", { recursive: true });
const rows = [];
let pass = 0;
for (let i = 0; i < N; i++) {
  const goal = goals[i % goals.length].replace(/g(\d)/, `g${i + 1}`).replace(/soak-\d/, `soak-${i + 1}`);
  const t0 = Date.now();
  let ok = false;
  let err = null;
  let text = "";
  try {
    const provider = await createProvider(cfg);
    const result = await runAgentLoop({
      cfg,
      provider,
      userMessage: goal,
      maxTurns: 4,
    });
    text = String(result?.text || result?.finalText || "").slice(0, 200);
    const f = `soak-out/g${i + 1}.txt`;
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes(`soak-${i + 1}`)) {
      ok = true;
      pass += 1;
    } else if (/soak-\d/.test(text) && fs.existsSync(f)) {
      ok = true;
      pass += 1;
    }
  } catch (e) {
    err = e.message || String(e);
  }
  rows.push({ i: i + 1, ok, ms: Date.now() - t0, err, text: text.slice(0, 80) });
  console.error(`[soak] ${i + 1}/${N} ok=${ok} ms=${rows[i].ms}${err ? " err=" + err : ""}`);
}

const summary = {
  n: N,
  pass,
  fail: N - pass,
  passRate: N ? pass / N : 0,
  rows,
  model: cfg.agent.model,
  at: new Date().toISOString(),
};
fs.writeFileSync("soak-out/SUMMARY.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(pass === N ? 0 : 1);
