/**
 * §13.3 harness adoption (v3.266.0) — default OFF: without
 * `gateway.runLoop: true` startGateway behaves exactly as before (owns
 * SIGINT/SIGTERM, blocks forever, exits on shutdown). With the flag, the
 * run-loop owns lifecycle: harness boots return a stop handle, never
 * register SIGINT/SIGTERM, and shutdown is exit-gated. clear() now
 * disarms the crash guard's exit hook (child-process proven).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GW = fs.readFileSync(new URL("../src/gateway/index.mjs", import.meta.url), "utf8");

describe("run-loop adoption (spec §13.3)", () => {
  it("flag check is strict, first thing after config load, and default OFF", () => {
    const startIdx = GW.indexOf("export async function startGateway");
    const body = GW.slice(startIdx);
    const cfgIdx = body.indexOf("const cfg = await loadConfig();");
    const flagIdx = body.indexOf("if (!harness && cfg.gateway?.runLoop === true) {");
    const bindIdx = body.indexOf("assertBindSafety(cfg)");
    assert.ok(cfgIdx > -1 && flagIdx > cfgIdx && bindIdx > flagIdx, "delegate before any boot work");
  });

  it("harness boot returns a stop handle and never registers SIGINT/SIGTERM", () => {
    const tail = GW.slice(GW.indexOf("const onSighup = () => {"));
    const harnessIdx = tail.indexOf("if (harness) {");
    const sigintIdx = tail.indexOf('process.on("SIGINT"');
    const sigtermIdx = tail.indexOf('process.on("SIGTERM"');
    assert.ok(harnessIdx > -1, "harness branch exists");
    assert.ok(sigintIdx > harnessIdx && sigtermIdx > harnessIdx, "SIGINT/SIGTERM only after the harness return");
    assert.match(tail, /stop: async \(reason\) => \{/);
    assert.match(tail, /await shutdown\(reason \|\| "harness stop", \{ exit: false \}\)/);
    assert.match(tail, /process\.removeListener\("SIGHUP", onSighup\)/);
  });

  it("shutdown is exit-gated so a harness stop cannot kill the process", () => {
    assert.match(GW, /const shutdown = async \(signal = "signal", \{ exit = true \} = \{\}\) => \{/);
    assert.match(GW, /if \(exit\) process\.exit\(0\);/);
    assert.doesNotMatch(
      GW.slice(GW.indexOf("const shutdown ="), GW.indexOf("const onSighup")),
      /^\s*process\.exit\(0\);$/m,
    );
  });

  it("supervised path: crash guard before the loop, clear() after a successful start, drainMs from config", () => {
    const sup = GW.slice(
      GW.indexOf("async function startGatewaySupervised"),
      GW.indexOf("export async function startGateway"),
    );
    const guardIdx = sup.indexOf("applyCrashLoopGuard(stateRoot)");
    const loopIdx = sup.indexOf("return runGatewayLoop({");
    const clearIdx = sup.indexOf("guard.clear()");
    assert.ok(guardIdx > -1 && loopIdx > guardIdx && clearIdx > loopIdx, "guard → loop → clear order");
    assert.match(sup, /drainMs: cfg\.shutdown\?\.drainMs \?\? 15_000/);
    assert.match(sup, /startGateway\(\{ root, harness: true \}\)/);
  });

  it("clear() disarms the exit hook — a cleared boot records no crash (real child process)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-adopt-guard-"));
    const file = path.join(dir, "gateway-crash-history.json");
    const href = new URL("../src/gateway/crash-guard.mjs", import.meta.url).href;
    const run = (extra) =>
      execFileSync(process.execPath, [
        "--input-type=module",
        "-e",
        `import { applyCrashLoopGuard } from ${JSON.stringify(href)};
         const g = applyCrashLoopGuard(${JSON.stringify(dir)});
         ${extra}
         process.exit(0);`,
      ]);
    run("");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).length, 1, "uncleaned exit records");
    run("g.clear();");
    assert.equal(fs.existsSync(file), false, "cleared boot records nothing");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
