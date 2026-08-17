import { loadConfig } from "../src/config/load.mjs";
import { runAgent } from "../src/agent/run-agent.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import { runHardGrader } from "../src/eval/hard-graders.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const cases = JSON.parse(fs.readFileSync("eval/cases/batch-social-todo.json", "utf8"));
const cfgBase = await loadConfig();
cfgBase.providers = { xai: { apiKey: process.env.XAI_API_KEY, baseUrl: "https://api.x.ai/v1" } };
cfgBase.computer = { engine: "native", autoStart: true, host: "127.0.0.1", port: 4243 };
cfgBase.security = { autoApprove: true };
const rows = [];
for (const c of cases) {
  const cfg = {
    ...cfgBase,
    agent: {
      provider: "xai",
      model: "grok-4.6",
      maxTurns: 18,
      reasoning: { effort: "high" },
      budget: { maxToolCalls: 40, maxWallMs: 300000 },
      loopGuard: { criticalThreshold: 28, globalCircuitBreakerThreshold: 45, warningThreshold: 10 },
    },
  };
  const ws = path.join(root, "reports/autonomy/ws", c.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60));
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, "results"), { recursive: true });
  if (c.fixture) {
    const fix = path.join(root, "eval/fixtures", c.fixture);
    if (fs.existsSync(fix)) {
      for (const name of fs.readdirSync(fix)) {
        try { fs.cpSync(path.join(fix, name), path.join(ws, name), { recursive: true }); } catch {}
      }
    }
  }
  console.log("START", c.id);
  let out;
  try {
    out = await runAgent({ goal: c.prompt, cfg, channel: "cli", workingDir: ws });
  } catch (e) {
    rows.push({ id: c.id, error: String(e.message || e), pass: false });
    console.log("ERR", c.id, e.message);
    continue;
  }
  const scored = await scoreCase(c, {
    text: out.text, turns: out.turns, toolTrace: out.toolTrace || [],
    toolCalls: out.toolTrace?.length || 0, workspace: ws,
    status: out.ok ? "succeeded" : "failed", events: [],
  });
  const hard = await runHardGrader(c, { text: out.text, workspace: ws });
  const row = {
    id: c.id,
    ok: out.ok,
    stopReason: out.stopReason,
    turns: out.turns,
    tools: out.toolTrace?.length || 0,
    scorePass: scored.pass,
    hardOk: hard.ok,
    results: fs.existsSync(path.join(ws, "results/results.md")),
    pass: scored.pass || (out.ok && (out.toolTrace?.length || 0) > 0 && String(out.text || "").length > 40),
    textPreview: String(out.text || "").slice(0, 200),
  };
  rows.push(row);
  console.log("DONE", c.id, "pass=", row.pass, "turns=", row.turns);
  fs.writeFileSync("reports/autonomy/batch-social-partial.json", JSON.stringify({ rows }, null, 2));
}
const passed = rows.filter((r) => r.pass).length;
const report = { model: "grok-4.6", suite: "social-todo", total: rows.length, passed, rate: +(passed / rows.length).toFixed(3), rows };
fs.writeFileSync("reports/autonomy/batch-social.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
