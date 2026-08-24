#!/usr/bin/env node
/**
 * A6-ops — Phase A enforcement smoke (core asserts; live computer optional).
 *
 * Exit 0 = pass, 1 = warnings only, 2 = failures
 *
 *   node scripts/a-enforcement-e2e.mjs
 *   XCLAW_ROOT=/path/to/xclaw node scripts/a-enforcement-e2e.mjs --json
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.XCLAW_ROOT || path.resolve(__dirname, "..");
process.env.XCLAW_ROOT = ROOT;

const jsonOut = process.argv.includes("--json");
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

async function main() {
  const need = [
    "src/browser/hooks.mjs",
    "src/browser/motor.mjs",
    "src/computer/chrome-args.mjs",
    "src/computer/hooks-bridge.mjs",
    "src/computer/xclaw-server.mjs",
  ];
  for (const rel of need) {
    if (fs.existsSync(path.join(ROOT, rel))) ok(`file.${rel}`, "present");
    else fail(`file.${rel}`, "missing");
  }

  const { buildChromeArgs, chromeArgsInvariants } = await import(
    mod("src/computer/chrome-args.mjs")
  );
  const args = buildChromeArgs({
    userDataDir: path.join(ROOT, ".tmp-a6-profile"),
    headless: true,
  });
  const inv = chromeArgsInvariants(args);
  if (inv.ok) ok("chrome_args.invariants", `${args.length} flags`);
  else fail("chrome_args.invariants", `missing ${inv.missing.join(",")}`);

  const { beforeNavigate, hooksStatus } = await import(mod("src/browser/hooks.mjs"));
  ok("hooks.status", JSON.stringify(hooksStatus()));

  const critic = await beforeNavigate({
    url: "https://example.com/",
    role: "critic",
    roleTrusted: true,
    agentId: "e2e",
  });
  if (!critic.ok && critic.code === "ROLE_NO_NAVIGATE") ok("hooks.critic_blocked", critic.code);
  else fail("hooks.critic_blocked", "critic should not navigate", critic);

  const actor = await beforeNavigate({
    url: "https://example.com/about",
    role: "actor",
    roleTrusted: true,
    agentId: "e2e",
  });
  if (actor.ok) ok("hooks.actor_ok", actor.actionId);
  else fail("hooks.actor_ok", actor.reason || actor.code, actor);

  process.env.XCLAW_COMMIT_GATES = "1";
  process.env.XCLAW_FABRIC_DIR =
    process.env.XCLAW_FABRIC_DIR || path.join(ROOT, ".tmp-a6-fabric");
  fs.mkdirSync(process.env.XCLAW_FABRIC_DIR, { recursive: true });
  const gated = await beforeNavigate({
    url: "https://shop.example/checkout",
    role: "actor",
    agentId: "e2e",
  });
  if (!gated.ok && gated.code === "COMMIT_GATE_REQUIRED") {
    ok("hooks.commit_gate", "checkout blocked without approval");
  } else {
    fail("hooks.commit_gate", "expected COMMIT_GATE_REQUIRED", gated);
  }
  delete process.env.XCLAW_COMMIT_GATES;

  const { planClick, planType } = await import(mod("src/browser/motor.mjs"));
  const click = planClick({ x: 100, y: 80, fromX: 0, fromY: 0, targetWidth: 24 });
  if (click.steps.some((s) => s.params?.type === "mousePressed")) {
    ok("motor.click_plan", `${click.steps.length} steps`);
  } else fail("motor.click_plan", "no mousePressed");
  const typed = planType({ text: "ab" });
  if (typed.meta.length === 2) ok("motor.type_plan", "2 chars");
  else fail("motor.type_plan", "bad length");

  try {
    const hooksMod = await import(mod("src/browser/hooks.mjs"));
    if (hooksMod?.hooksStatus) ok("enforce.hooks", "hooks.mjs loaded");
    else fail("enforce.hooks", "hooks.mjs missing hooksStatus");
  } catch (e) {
    fail("enforce.hooks", e.message || String(e));
  }

  try {
    const { isComputerRunning } = await import(mod("src/computer/manager.mjs"));
    const { loadConfig } = await import(mod("src/config/load.mjs"));
    const cfg = await loadConfig({ strict: false });
    if (await isComputerRunning(cfg)) ok("computer.live", "healthy");
    else warn("computer.live", "not running — xclaw computer start");
  } catch (e) {
    warn("computer.live", e.message || String(e));
  }

  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const exitCode = fails ? 2 : warns ? 1 : 0;

  if (jsonOut) {
    console.log(
      JSON.stringify(
        { ok: fails === 0, exitCode, fails, warns, root: ROOT, results, at: new Date().toISOString() },
        null,
        2
      )
    );
  } else {
    console.log("XClaw A-enforcement e2e smoke\n");
    console.log(`ROOT=${ROOT}\n`);
    for (const r of results) {
      const tag = r.status === "ok" ? "OK  " : r.status === "warn" ? "WARN" : "FAIL";
      console.log(`  [${tag}] ${r.id}: ${r.message}`);
    }
    console.log(`\nSummary: ${fails} fail(s), ${warns} warning(s) — exit ${exitCode}`);
  }
  process.exitCode = exitCode;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
