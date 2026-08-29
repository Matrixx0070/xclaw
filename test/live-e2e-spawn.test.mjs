import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runLiveE2eCheck,
  liveE2eCronOptionsFromConfig,
  resolveRunBudget,
} from "../src/cron/live-e2e-job.mjs";
import {
  gradeLiveE2e,
  CODE_SIGNAL,
  CODE_TIMEOUT,
  CODE_SPAWN_ERROR,
} from "../src/cron/live-e2e-grade.mjs";

function tmpRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xclaw-live-e2e-spawn-${name}-`));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  return dir;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A promise that rejects rather than hanging the runner, so a missing timeout
// shows up as a failure instead of a stalled suite.
function within(ms, promise) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`did not settle within ${ms}ms`)), ms);
    }),
  ]);
}

test("the substitute exit codes stay outside the producer's 0/1/2 range", () => {
  for (const code of [CODE_SIGNAL, CODE_TIMEOUT, CODE_SPAWN_ERROR]) {
    assert.ok(code >= 3, `${code} collides with the producer's range`);
  }
  assert.equal(new Set([CODE_SIGNAL, CODE_TIMEOUT, CODE_SPAWN_ERROR]).size, 3);
});

test("a timeout and a spawn error are hard failures with their own reason", () => {
  assert.deepEqual(gradeLiveE2e({ code: CODE_TIMEOUT, reportOk: false, parsed: false }), {
    ok: false,
    hardFail: true,
    reason: "timeout",
  });
  assert.deepEqual(gradeLiveE2e({ code: CODE_SPAWN_ERROR, reportOk: false, parsed: false }), {
    ok: false,
    hardFail: true,
    reason: "spawn-error",
  });
});

test("a spawn that never starts resolves a verdict instead of crashing the process", async () => {
  const dir = tmpRoot("badcwd");
  try {
    // A cwd that does not exist makes spawn emit 'error'; with no listener the
    // whole daemon dies on an unhandled 'error' event.
    const r = await within(
      10_000,
      runLiveE2eCheck({
        root: path.join(dir, "gone"),
        logPath: path.join(dir, "cron.log"),
        notifyOnFail: false,
      })
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE_SPAWN_ERROR);
    assert.equal(r.reason, "spawn-error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unrunnable interpreter resolves a verdict instead of crashing the process", async () => {
  const dir = tmpRoot("badexe");
  try {
    fs.writeFileSync(path.join(dir, "scripts/live-enforcement-e2e.mjs"), "");
    const r = await within(
      10_000,
      runLiveE2eCheck({
        root: dir,
        exe: path.join(dir, "no-such-node"),
        logPath: path.join(dir, "cron.log"),
        notifyOnFail: false,
      })
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE_SPAWN_ERROR);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a hung check is bounded by a timeout and reported as one", async () => {
  const dir = tmpRoot("hang");
  try {
    fs.writeFileSync(
      path.join(dir, "scripts/live-enforcement-e2e.mjs"),
      "setInterval(() => {}, 1000);\n"
    );
    const r = await within(
      15_000,
      runLiveE2eCheck({
        root: dir,
        logPath: path.join(dir, "cron.log"),
        notifyOnFail: false,
        timeoutMs: 1200,
        graceMs: 300,
      })
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE_TIMEOUT);
    assert.equal(r.reason, "timeout");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the timeout kill reaches the whole process group, not just the direct child", async () => {
  const dir = tmpRoot("group");
  const pidFile = path.join(dir, "pids.txt");
  try {
    // A helper the check spawns normally (i.e. NOT detached) stays in the
    // child's process group, and a kill aimed only at the direct child leaves
    // it running. The detached computer server is a different case and is
    // deliberately left alive -- see killTree in src/cron/live-e2e-job.mjs.
    fs.writeFileSync(
      path.join(dir, "scripts/live-enforcement-e2e.mjs"),
      [
        'import fs from "node:fs";',
        'import { spawn } from "node:child_process";',
        `const pidFile = ${JSON.stringify(pidFile)};`,
        'const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        'fs.writeFileSync(pidFile, `${process.pid}\\n${g.pid}\\n`);',
        "setInterval(() => {}, 1000);",
      ].join("\n") + "\n"
    );
    await within(
      15_000,
      runLiveE2eCheck({
        root: dir,
        logPath: path.join(dir, "cron.log"),
        notifyOnFail: false,
        timeoutMs: 1500,
        graceMs: 300,
      })
    );
    const pids = fs
      .readFileSync(pidFile, "utf8")
      .trim()
      .split("\n")
      .map((n) => Number(n));
    assert.equal(pids.length, 2);
    await new Promise((r) => setTimeout(r, 300));
    for (const pid of pids) {
      assert.equal(alive(pid), false, `pid ${pid} survived the timeout kill`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the cron option mapper defaults every key ensureLiveE2eCronJob reads", () => {
  const o = liveE2eCronOptionsFromConfig({});
  assert.deepEqual(o, {
    everyMs: 86_400_000,
    delivery: null,
    strict: false,
    enabled: true,
    notifyOnFail: true,
    timeoutMs: 600_000,
    graceMs: 2_000,
  });
  // ensureLiveE2eCronJob reads exactly these; a key missing here is a
  // capability dropped in transit between xclaw.json and the job.
  for (const k of ["everyMs", "delivery", "strict", "enabled", "notifyOnFail", "timeoutMs", "graceMs"]) {
    assert.ok(k in o, `mapper drops ${k}`);
  }
});

test("a documented enabled:false is actually honoured", () => {
  // docs/PROD_PRESET.md has documented liveE2e.cron.enabled since the feature
  // shipped, and nothing read it: bin/xclaw.mjs hand-copied everyMs/delivery/
  // strict across and never passed enabled, so the job ran anyway.
  assert.equal(liveE2eCronOptionsFromConfig({ liveE2e: { cron: { enabled: false } } }).enabled, false);
  assert.equal(liveE2eCronOptionsFromConfig({ liveE2e: { cron: { enabled: true } } }).enabled, true);
  assert.equal(liveE2eCronOptionsFromConfig({ liveE2e: { cron: {} } }).enabled, true);
});

test("the run budget is configurable and never falls back to zero", () => {
  const c = (cron) => liveE2eCronOptionsFromConfig({ liveE2e: { cron } });
  assert.equal(c({ timeoutMs: 90_000 }).timeoutMs, 90_000);
  assert.equal(c({ graceMs: 5_000 }).graceMs, 5_000);
  // timeoutMs: 0 disables the timeout inside runLiveE2e, which is the very
  // fail-open this slice closed. A junk or zero value must not reach it.
  for (const bad of [0, -1, "x", null]) {
    assert.equal(c({ timeoutMs: bad }).timeoutMs, 600_000, `timeoutMs ${bad}`);
    assert.equal(c({ graceMs: bad }).graceMs, 2_000, `graceMs ${bad}`);
  }
});

test("the CLI positional overrides everyMs, and junk falls back to config", () => {
  const cfg = { liveE2e: { cron: { everyMs: 3_600_000 } } };
  assert.equal(liveE2eCronOptionsFromConfig(cfg, { everyMsArg: "600000" }).everyMs, 600_000);
  assert.equal(liveE2eCronOptionsFromConfig(cfg, { everyMsArg: "--strict" }).everyMs, 3_600_000);
  assert.equal(liveE2eCronOptionsFromConfig(cfg, {}).everyMs, 3_600_000);
});

test("strict is honoured and defaults off", () => {
  const c = (cron) => liveE2eCronOptionsFromConfig({ liveE2e: { cron } });
  assert.equal(c({ strict: true }).strict, true);
  assert.equal(c({}).strict, false);
  // strict goes straight to gradeLiveE2e, where it turns ANY non-zero exit into
  // a hard failure. A truthy string must not switch that on by accident.
  assert.equal(c({ strict: "yes" }).strict, false);
});

test("a junk run budget falls back to the default instead of disabling the timer", () => {
  // Number("abc") is NaN, which `??` passes straight through: it is neither
  // null nor undefined. NaN then fails `timeoutMs > 0` inside runLiveE2e, so
  // no timer is armed at all -- the unbounded-run fail-open, reinstated.
  for (const bad of [NaN, undefined, null, "600", {}]) {
    assert.equal(resolveRunBudget({ timeoutMs: bad, graceMs: bad }).timeoutMs, 600_000, `${String(bad)}`);
    assert.equal(resolveRunBudget({ timeoutMs: bad, graceMs: bad }).graceMs, 2_000, `${String(bad)}`);
  }
  assert.deepEqual(resolveRunBudget({ timeoutMs: 1234, graceMs: 56 }), { timeoutMs: 1234, graceMs: 56 });
  // 0 is a deliberate escape hatch, not junk: it must survive the guard.
  assert.equal(resolveRunBudget({ timeoutMs: 0 }).timeoutMs, 0);
  assert.deepEqual(resolveRunBudget(), { timeoutMs: 600_000, graceMs: 2_000 });
});
