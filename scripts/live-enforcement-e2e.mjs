#!/usr/bin/env node
/**
 * LIVE-E2E — Phase A enforcement against a real computer process.
 *
 * 1. Ensures computer is healthy (starts it if needed)
 * 2. Creates a session
 * 3. Probes tools/call for:
 *    - commit gate on /checkout
 *    - jsCode motor pattern under fabric
 *    - optional motor click / normal navigate
 *
 * Usage:
 *   XCLAW_ROOT=/path/to/xclaw node scripts/live-enforcement-e2e.mjs
 *   node scripts/live-enforcement-e2e.mjs --json
 *   node scripts/live-enforcement-e2e.mjs --no-start   # don't spawn computer
 *   node scripts/live-enforcement-e2e.mjs --keep        # leave computer running
 *
 * Exit: 0 pass, 1 warnings, 2 failures
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.XCLAW_ROOT || path.resolve(__dirname, "..");
process.env.XCLAW_ROOT = ROOT;

const jsonOut = process.argv.includes("--json");
const noStart = process.argv.includes("--no-start");
const keep = process.argv.includes("--keep");

const results = [];
function ok(id, message, detail) {
  results.push({ id, status: "ok", message, detail });
}
function warn(id, message, detail) {
  results.push({ id, status: "warn", message, detail });
}
function fail(id, message, detail) {
  results.push({ id, status: "fail", message, detail });
}

function mod(rel) {
  return pathToFileURL(path.join(ROOT, rel)).href;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toolErrorText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (result.error) return String(result.error);
  if (result.isError && Array.isArray(result.content)) {
    return result.content.map((c) => c.text || "").join(" ");
  }
  if (result.data?.error) return String(result.data.error);
  if (result.resultForAssistant) return String(result.resultForAssistant);
  try {
    return JSON.stringify(result).slice(0, 800);
  } catch {
    return String(result);
  }
}

async function main() {
  // Enforcement env for this process + child computer inherits via startComputer
  process.env.XCLAW_COMMIT_GATES = process.env.XCLAW_COMMIT_GATES || "1";
  process.env.XCLAW_FABRIC_ENFORCE = process.env.XCLAW_FABRIC_ENFORCE || "1";
  process.env.XCLAW_JSCODE_MODE = process.env.XCLAW_JSCODE_MODE || "read";
  process.env.XCLAW_ROLE_FROM_ENV = process.env.XCLAW_ROLE_FROM_ENV || "1";
  process.env.XCLAW_AGENT_ROLE = process.env.XCLAW_AGENT_ROLE || "actor";
  process.env.XCLAW_AGENT_ID = process.env.XCLAW_AGENT_ID || "live-e2e";
  process.env.XCLAW_SESSION_ID = process.env.XCLAW_SESSION_ID || "live-e2e";
  process.env.XCLAW_FABRIC_DIR =
    process.env.XCLAW_FABRIC_DIR || path.join(ROOT, ".tmp-live-e2e-fabric");
  fs.mkdirSync(process.env.XCLAW_FABRIC_DIR, { recursive: true });
  const { loadConfig } = await import(mod("src/config/load.mjs"));
  const { isComputerRunning, startComputer, stopComputer, getComputerStatus } =
    await import(mod("src/computer/manager.mjs"));
  const { createComputerClient } = await import(mod("src/agent/computer-client.mjs"));
  const { bindRole } = await import(mod("src/browser/role-binding.mjs"));

  let cfg = await loadConfig({ strict: false });
  let startedByUs = false;

  // --- computer up ---
  let healthy = await isComputerRunning(cfg);
  if (!healthy && !noStart) {
    ok("computer.start", "starting computer…");
    try {
      await startComputer({ root: ROOT, foreground: false });
      startedByUs = true;
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        cfg = await loadConfig({ strict: false });
        if (await isComputerRunning(cfg)) {
          healthy = true;
          break;
        }
      }
    } catch (e) {
      fail("computer.start", e.message || String(e));
    }
  }

  if (healthy) {
    ok("computer.health", "healthy");
  } else {
    fail("computer.health", "computer not healthy — start manually or check logs");
  }

  if (!healthy) {
    return finish();
  }

  const client = createComputerClient(cfg);
  let sessionId = null;

  try {
    sessionId = await client.createSession(ROOT);
    ok("session.create", sessionId);
  } catch (e) {
    fail("session.create", e.message || String(e));
    return finish({ startedByUs, cfg });
  }

  // Bind actor for this session id (and env agent id)
  try {
    await bindRole(sessionId, "actor", { source: "live-e2e" });
    await bindRole(process.env.XCLAW_AGENT_ID, "actor", { source: "live-e2e" });
    ok("role.bind", "actor");
  } catch (e) {
    warn("role.bind", e.message || String(e));
  }

  // List tools — ensure browser tab exists
  try {
    const tools = await client.listTools(sessionId);
    const names = tools.map((t) => t.name);
    if (names.includes("xclaw_browser_tab")) ok("tools.browser_tab", "present");
    else fail("tools.browser_tab", `missing; got ${names.slice(0, 12).join(",")}`);
  } catch (e) {
    fail("tools.list", e.message || String(e));
  }

  // --- 1) Commit gate: checkout must fail without approval ---
  try {
    const r = await client.callTool(sessionId, "xclaw_browser_tab", {
      url: "https://shop.example/checkout",
      waitTime: 0.1,
    });
    const text = toolErrorText(r);
    if (
      /COMMIT_GATE|xclaw-hooks|beforeNavigate|HOOKS_UNAVAILABLE/i.test(text) ||
      r?.isError
    ) {
      ok("live.commit_gate", "checkout blocked on computer path", text.slice(0, 200));
    } else if (text.includes("Chrome") || text.includes("chrome") || /not found/i.test(text)) {
      // Gate may not have run if chrome failed first — still note
      warn("live.commit_gate", "chrome issue before/with gate", text.slice(0, 240));
    } else {
      fail("live.commit_gate", "expected block, got success-like result", text.slice(0, 300));
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (/COMMIT_GATE|xclaw-hooks/i.test(msg)) ok("live.commit_gate", "blocked via throw", msg);
    else warn("live.commit_gate", msg);
  }

  // --- 2) jsCode motor pattern denied under fabric ---
  try {
    const r = await client.callTool(sessionId, "xclaw_browser_tab", {
      jsCode: "document.body.click()",
      waitTime: 0.05,
    });
    const text = toolErrorText(r);
    if (/JSCODE_MOTOR|xclaw-hooks|beforeInput/i.test(text) || r?.isError) {
      ok("live.jscode_block", "motor-like jsCode blocked", text.slice(0, 200));
    } else if (/Chrome|chrome|not found/i.test(text)) {
      warn("live.jscode_block", "chrome unavailable; cannot fully prove", text.slice(0, 200));
    } else {
      fail("live.jscode_block", "jsCode click should be blocked", text.slice(0, 300));
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (/JSCODE|xclaw-hooks/i.test(msg)) ok("live.jscode_block", msg);
    else warn("live.jscode_block", msg);
  }

  // --- 3) Read-only jsCode should not be blocked by policy (chrome may still fail) ---
  try {
    const r = await client.callTool(sessionId, "xclaw_browser_tab", {
      jsCode: "return document.title || 'ok'",
      waitTime: 0.05,
    });
    const text = toolErrorText(r);
    if (/JSCODE_MOTOR|JSCODE_DENIED/i.test(text)) {
      fail("live.jscode_read", "read jsCode incorrectly blocked", text.slice(0, 200));
    } else {
      ok("live.jscode_read", "not policy-blocked (chrome may still fail)", text.slice(0, 160));
    }
  } catch (e) {
    const msg = e.message || String(e);
    if (/JSCODE_MOTOR|JSCODE_DENIED/i.test(msg)) fail("live.jscode_read", msg);
    else ok("live.jscode_read", "not policy-blocked", msg.slice(0, 160));
  }

  // --- 4) Optional motor plan path (may need chrome + display) ---
  try {
    const r = await client.callTool(sessionId, "xclaw_browser_tab", {
      motor: { op: "click", x: 5, y: 5, fromX: 0, fromY: 0, targetWidth: 20 },
      waitTime: 0.05,
    });
    const text = toolErrorText(r);
    if (/MOTOR_UNAVAILABLE|xclaw-motor/i.test(text)) {
      warn("live.motor", "motor bridge missing in computer env", text.slice(0, 200));
    } else if (/Chrome|chrome path|not found|No usable/i.test(text)) {
      warn("live.motor", "chrome not available for motor dispatch", text.slice(0, 200));
    } else if (/ROLE_NO|TAB_LEASE|xclaw-hooks/i.test(text) && !/motor/i.test(text)) {
      warn("live.motor", "blocked by fabric before motor", text.slice(0, 200));
    } else {
      ok("live.motor", "motor call returned", text.slice(0, 160));
    }
  } catch (e) {
    warn("live.motor", e.message || String(e));
  }

  // --- 5) Normal navigate may work if chrome exists ---
  try {
    const r = await client.callTool(sessionId, "xclaw_browser_tab", {
      url: "https://example.com/",
      waitTime: 0.5,
    });
    const text = toolErrorText(r);
    if (/COMMIT_GATE/i.test(text)) {
      fail("live.nav_safe", "example.com should not need commit gate", text.slice(0, 200));
    } else if (/Chrome|not found|failed to launch/i.test(text)) {
      warn("live.nav_safe", "chrome unavailable", text.slice(0, 200));
    } else {
      ok("live.nav_safe", "navigate attempted", text.slice(0, 160));
    }
  } catch (e) {
    warn("live.nav_safe", e.message || String(e));
  }

  // cleanup session
  try {
    if (sessionId) await client.destroySession(sessionId);
    ok("session.destroy", "done");
  } catch (e) {
    warn("session.destroy", e.message || String(e));
  }

  await finish({ startedByUs, cfg, stopComputer, keep });
}

async function finish(extra = {}) {
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const exitCode = fails ? 2 : warns ? 1 : 0;

  if (extra.startedByUs && !keep && extra.stopComputer && extra.cfg) {
    try {
      await extra.stopComputer(extra.cfg);
      ok("computer.stop", "stopped (started by this script)");
    } catch (e) {
      warn("computer.stop", e.message || String(e));
    }
  }

  const fails2 = results.filter((r) => r.status === "fail").length;
  const warns2 = results.filter((r) => r.status === "warn").length;
  const code = fails2 ? 2 : warns2 ? 1 : 0;

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: fails2 === 0,
          exitCode: code,
          fails: fails2,
          warns: warns2,
          root: ROOT,
          results,
          at: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } else {
    console.log("XClaw LIVE enforcement e2e\n");
    console.log(`ROOT=${ROOT}`);
    console.log(
      `COMMIT_GATES=${process.env.XCLAW_COMMIT_GATES} FABRIC_ENFORCE=${process.env.XCLAW_FABRIC_ENFORCE}\n`
    );
    for (const r of results) {
      const tag = r.status === "ok" ? "OK  " : r.status === "warn" ? "WARN" : "FAIL";
      console.log(`  [${tag}] ${r.id}: ${r.message}`);
    }
    console.log(`\nSummary: ${fails2} fail(s), ${warns2} warning(s) — exit ${code}`);
  }
  process.exitCode = code;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
