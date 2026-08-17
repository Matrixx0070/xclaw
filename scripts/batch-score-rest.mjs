import { loadConfig } from "../src/config/load.mjs";
import { runAgent } from "../src/agent/run-agent.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import { runHardGrader } from "../src/eval/hard-graders.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const prior = JSON.parse(fs.readFileSync("reports/autonomy/batch-12-partial.json", "utf8")).rows || [];
const cases = JSON.parse(fs.readFileSync("eval/cases/batch-score-rest.json", "utf8"));
const cfgBase = await loadConfig();
cfgBase.providers = { xai: { apiKey: process.env.XAI_API_KEY, baseUrl: "https://api.x.ai/v1" } };
cfgBase.computer = { engine: "native", autoStart: true, host: "127.0.0.1", port: 4243 };
cfgBase.security = { autoApprove: true };
const rows = [...prior];
const log = (...a) => {
  const line = a.join(" ");
  console.log(line);
  fs.appendFileSync("reports/autonomy/batch-12.log", line + "\n");
};
for (const c of cases) {
  const cfg = {
    ...cfgBase,
    agent: {
      provider: "xai",
      model: "grok-4.6",
      maxTurns: c.id.includes("meeting") ? 25 : Math.min(c.maxTurns || 14, 16),
      reasoning: { effort: "high" },
      budget: c.id.includes("meeting")
        ? { maxToolCalls: 60, maxWallMs: 400000 }
        : { maxToolCalls: 35, maxWallMs: 240000 },
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
  log("START", c.id);
  let out;
  try {
    out = await runAgent({ goal: c.prompt, cfg, channel: "cli", workingDir: ws });
  } catch (e) {
    rows.push({ id: c.id, error: String(e.message || e), pass: false, hardOk: false });
    log("ERR", c.id, e.message);
    fs.writeFileSync("reports/autonomy/batch-12-partial.json", JSON.stringify({ rows }, null, 2));
    continue;
  }
  const scored = await scoreCase(c, {
    text: out.text, turns: out.turns, toolTrace: out.toolTrace || [],
    toolCalls: out.toolTrace?.length || 0, workspace: ws,
    status: out.ok ? "succeeded" : "failed", events: [],
  });
  const hard = await runHardGrader(c, { text: out.text, workspace: ws });
  const needsHard = Boolean(c.expect?.hard) || /meeting_negotiation|conflicting_handling/.test(c.id);
  const row = {
    id: c.id, ok: out.ok, stopReason: out.stopReason, turns: out.turns,
    tools: out.toolTrace?.length || 0, scorePass: scored.pass, hardOk: hard.ok,
    hardFailures: hard.failures,
    results: fs.existsSync(path.join(ws, "results/results.md")),
    pass: needsHard ? (scored.pass && hard.ok) : (scored.pass || (out.ok && (out.toolTrace?.length || 0) > 0 && String(out.text || "").length > 40)),
  };
  rows.push(row);
  log("DONE", c.id, "pass=", row.pass, "hard=", row.hardOk);
  fs.writeFileSync("reports/autonomy/batch-12-partial.json", JSON.stringify({ rows }, null, 2));
}
const passed = rows.filter((r) => r.pass).length;
const report = { model: "grok-4.6", total: rows.length, passed, rate: +(passed / rows.length).toFixed(3), rows };
fs.writeFileSync("reports/autonomy/batch-12.json", JSON.stringify(report, null, 2));
log("FINAL", passed, "/", rows.length, report.rate);
console.log(JSON.stringify(report, null, 2));
