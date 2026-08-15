#!/usr/bin/env node
/**
 * Live smoke: real xAI + native computer + file write.
 * Also exercises bash timeout sanitization if model uses bash.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/config/load.mjs";
import { runAgentLoop } from "../src/agent/loop.mjs";
import { startComputer, isComputerRunning } from "../src/computer/manager.mjs";
import {
  normalizeBashTimeoutSeconds,
  executeBash,
} from "../src/computer/modules/bash-tool.mjs";
import { sanitizeToolArgs } from "../src/agent/computer-client.mjs";

// Local unit assert (no network)
const n = normalizeBashTimeoutSeconds(120_000);
if (n !== 120) {
  console.error("normalize failed", n);
  process.exit(2);
}
const s = sanitizeToolArgs("xclaw_bash", { command: "true", timeout: 300_000 });
if (s.timeout !== 120) {
  console.error("sanitize failed", s);
  process.exit(2);
}
const br = await executeBash(
  { command: "echo clamp-ok", timeout: 120_000 },
  { cwd: "/tmp" }
);
if (!br.ok) {
  console.error("executeBash with ms timeout failed", br);
  process.exit(2);
}
console.error("[smoke] timeout normalize + executeBash OK");

if (!process.env.XAI_API_KEY) {
  console.error("[smoke] no XAI_API_KEY — skip live agent");
  process.exit(0);
}

process.env.XCLAW_COMPUTER_ENGINE = "native";
const work = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-live-"));
const hello = path.join(work, "hello.txt");
const cfg = await loadConfig();
cfg.computer = {
  engine: "native",
  nativeServer: true,
  autoStart: true,
  port: 4243,
};
cfg.agent = {
  maxTurns: 6,
  model: process.env.XCLAW_MODEL || "grok-3",
  apiKey: process.env.XAI_API_KEY,
  baseUrl: "https://api.x.ai/v1",
  provider: "xai",
  allowTools: ["xclaw_file_write", "xclaw_file_read", "xclaw_bash"],
};
cfg.security = { autoApprove: true };
cfg.router = { ...(cfg.router || {}), roleEffortEnabled: false };

if (!(await isComputerRunning(cfg))) {
  console.error("[smoke] starting computer…");
  await startComputer({ root: process.cwd(), cfg, foreground: false });
}

const result = await runAgentLoop({
  userMessage: `Write exact text xclaw-p2-ok to ${hello} using xclaw_file_write. Reply OK when done.`,
  cfg,
  chatSessionId: `timeout-smoke-${Date.now().toString(36)}`,
  onEvent: (e) => {
    if (e.type === "tool") console.error("TOOL", e.phase, e.name);
  },
});

let body = "";
try {
  body = await fs.readFile(hello, "utf8");
} catch {
  /* */
}

const report = {
  ok: body.trim() === "xclaw-p2-ok",
  body: body.trim(),
  text: String(result.text || "").slice(0, 200),
  turns: result.turns,
  usage: result.usage || null,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
